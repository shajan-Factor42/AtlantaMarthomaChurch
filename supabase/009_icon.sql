-- =====================================================================
-- IconCMO integration (read-only from ICON → portal)
-- The icon-sync edge function pulls households, members, pledges and posted
-- contributions from the IconCMO API into private staging tables (icon_*),
-- then public.icon_merge() folds them into families / members / contributions /
-- pledges. icon_merge(..., p_dry => true) reports what WOULD change and rolls back.
-- Data pulled from ICON's public test database is only ever merged as a dry run.
-- =====================================================================

-- ---------- Links from portal rows to ICON records -------------------
alter table public.families      add column if not exists icon_household_id text unique;
alter table public.families      add column if not exists icon_synced_at   timestamptz;
alter table public.members       add column if not exists icon_member_id   text unique;
alter table public.members       add column if not exists status           text not null default 'active';
alter table public.members       drop constraint if exists members_status_check;
alter table public.members       add constraint members_status_check check (status in ('active','inactive','deceased'));
alter table public.contributions add column if not exists icon_id          text unique;
alter table public.contributions add column if not exists source           text not null default 'manual';
alter table public.pledges       add column if not exists icon_id          text unique;

-- ---------- Staging (service role only; no policies) ------------------
create table if not exists public.icon_households    (id text primary key, data jsonb not null, source text not null, pulled_at timestamptz not null default now());
create table if not exists public.icon_members       (id text primary key, household_id text, data jsonb not null, source text not null, pulled_at timestamptz not null default now());
create table if not exists public.icon_contributions (id text primary key, household_id text, date_given date, data jsonb not null, source text not null, pulled_at timestamptz not null default now());
create table if not exists public.icon_pledges       (id text primary key, household_id text, data jsonb not null, source text not null, pulled_at timestamptz not null default now());
alter table public.icon_households    enable row level security;
alter table public.icon_members       enable row level security;
alter table public.icon_contributions enable row level security;
alter table public.icon_pledges       enable row level security;

-- History of sync runs (officers can read it in Admin)
create table if not exists public.icon_sync_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  source      text not null,            -- 'live' or 'test'
  dry_run     boolean not null,
  trigger     text not null,            -- 'admin' or 'nightly'
  ok          boolean,
  summary     jsonb,
  error       text
);
alter table public.icon_sync_runs enable row level security;
create policy icon_runs_officer_read on public.icon_sync_runs for select to authenticated using (public.is_officer());

insert into public.portal_settings (key, value) values ('icon', jsonb_build_object(
  'enabled', false,          -- nightly sync on/off
  'giving_from_icon', false, -- hide manual entry in Admin → Giving
  'start_year', extract(year from now())::int - 3
)) on conflict (key) do nothing;

-- ---------- Helpers ---------------------------------------------------
create or replace function public.icon_money(t text) returns numeric language sql immutable as $$
  select coalesce(nullif(regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0)
$$;
create or replace function public.icon_date(t text) returns date language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' and t !~ '^0000' then left(t, 10)::date end
$$;
-- ICON household/member status → portal family status
create or replace function public.icon_family_status(s text) returns text language sql immutable as $$
  select case
    when s is null then 'active'
    when lower(s) in ('inactive','lost','delete','deleted','deceased','transferred','moved') then 'inactive'
    when lower(s) in ('visitor','prospect','friend','nonmember','non-member') then 'visitor'
    else 'active' end
$$;
-- ICON relationship → portal relationship
create or replace function public.icon_relationship(r text, has_husband boolean) returns text language sql immutable as $$
  select case lower(coalesce(r, ''))
    when 'husband' then 'Head'
    when 'wife' then case when has_husband then 'Spouse' else 'Head' end
    when 'single male' then 'Head' when 'single female' then 'Head'
    when 'widow' then 'Head' when 'widower' then 'Head' when 'divorced' then 'Head'
    when 'son' then 'Son' when 'daughter' then 'Daughter'
    when 'father' then 'Father' when 'mother' then 'Mother'
    when 'grandfather' then 'Grandparent' when 'grandmother' then 'Grandparent'
    else 'Other' end
$$;

-- ---------- The merge -------------------------------------------------
create or replace function public.icon_merge_apply(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  h record; m record; c record; p record;
  fam uuid; mid uuid; d jsonb; em text; ph text; st text; rel text;
  has_h boolean; n_new_f int := 0; n_upd_f int := 0; n_new_m int := 0; n_upd_m int := 0;
  n_inact_m int := 0; n_email_skip int := 0; n_c_new int := 0; n_c_upd int := 0; n_c_del int := 0; n_c_skip int := 0;
  n_p int := 0; total numeric := 0; samples_f jsonb := '[]'; samples_m jsonb := '[]'; ex record;
begin
  -- 1) Households → families
  for h in select * from icon_households order by id loop
    d := h.data;
    select id into fam from families where icon_household_id = h.id;
    if fam is null then
      -- First link: a family already in the portal whose member shares a name or email with this ICON household
      select f.id into fam from families f
        join members pm on pm.family_id = f.id
        join icon_members im on im.household_id = h.id
       where f.icon_household_id is null
         and ( (pm.email is not null and exists (select 1 from jsonb_array_elements(coalesce(im.data->'emails','[]')) e where lower(e->>'email') = lower(pm.email)))
            or (lower(pm.first_name) = lower(coalesce(im.data->>'preferred_name', im.data->>'first_name')) and lower(pm.last_name) = lower(im.data->>'last_name')) )
       limit 1;
    end if;
    if fam is null then
      insert into families (family_name, address_line1, address_line2, city, state, zip, home_phone, status, icon_household_id, icon_synced_at)
      values (
        coalesce(nullif(trim(coalesce(d->>'last_name','') || coalesce(', ' || nullif(d->>'first_name',''), '')), ''), d->>'mail_to', 'ICON household ' || h.id),
        d->>'address_1', d->>'address_2', d->>'city', d->>'state', d->>'zip', d->>'phone', icon_family_status(d->>'status'), h.id, now())
      returning id into fam;
      n_new_f := n_new_f + 1;
      if jsonb_array_length(samples_f) < 8 then samples_f := samples_f || to_jsonb(coalesce(d->>'mail_to', d->>'last_name')); end if;
    else
      update families set
        family_name = coalesce(nullif(trim(coalesce(d->>'last_name','') || coalesce(', ' || nullif(d->>'first_name',''), '')), ''), family_name),
        address_line1 = d->>'address_1', address_line2 = d->>'address_2', city = d->>'city', state = d->>'state', zip = d->>'zip',
        home_phone = coalesce(d->>'phone', home_phone), status = icon_family_status(d->>'status'),
        icon_household_id = h.id, icon_synced_at = now(), updated_at = now()
      where id = fam;
      n_upd_f := n_upd_f + 1;
    end if;
  end loop;

  -- 2) Members
  for m in select im.*, f.id as fam_id from icon_members im join families f on f.icon_household_id = im.household_id order by im.id loop
    d := m.data;
    has_h := exists (select 1 from icon_members x where x.household_id = m.household_id and lower(x.data->>'relationship') = 'husband');
    rel := icon_relationship(d->>'relationship', has_h);
    st := case
      when exists (select 1 from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Deceased' and icon_date(s->>'date') is not null) then 'deceased'
      when icon_family_status(d->>'status') = 'inactive' then 'inactive'
      else 'active' end;
    select e->>'email' into em from jsonb_array_elements(coalesce(d->'emails','[]')) e
      where coalesce(e->>'email','') like '%@%' order by (e->>'id' = 'Personal Email') desc limit 1;
    select x->>'phone' into ph from jsonb_array_elements(coalesce(d->'phones','[]')) x
      where coalesce(x->>'phone','') <> '' order by (x->>'id' in ('Mobile','Cell')) desc limit 1;
    mid := null;
    select id into mid from members where icon_member_id = m.id;
    if mid is null then
      select id into mid from members where icon_member_id is null and family_id = m.fam_id
        and lower(first_name) = lower(coalesce(d->>'preferred_name', d->>'first_name')) and lower(last_name) = lower(d->>'last_name') limit 1;
    end if;
    if mid is null and em is not null then
      select id into mid from members where icon_member_id is null and lower(email) = lower(em) limit 1;
    end if;
    if mid is null then
      insert into members (family_id, first_name, last_name, mobile_phone, date_of_birth, wedding_date, relationship, baptized, confirmed, status, icon_member_id)
      values (m.fam_id, coalesce(nullif(d->>'preferred_name',''), d->>'first_name', '?'), coalesce(d->>'last_name', ''), ph,
        (select icon_date(s->>'date') from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Birth' limit 1),
        (select icon_date(s->>'date') from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Marriage' limit 1),
        rel,
        exists (select 1 from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Baptism' and icon_date(s->>'date') is not null),
        exists (select 1 from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Confirmation' and icon_date(s->>'date') is not null),
        st, m.id)
      returning id into mid;
      n_new_m := n_new_m + 1;
      if jsonb_array_length(samples_m) < 8 then samples_m := samples_m || to_jsonb(coalesce(d->>'preferred_name', d->>'first_name') || ' ' || coalesce(d->>'last_name','')); end if;
    else
      update members set
        family_id = m.fam_id,
        first_name = coalesce(nullif(d->>'preferred_name',''), d->>'first_name', first_name),
        last_name = coalesce(d->>'last_name', last_name),
        mobile_phone = coalesce(ph, mobile_phone),
        date_of_birth = coalesce((select icon_date(s->>'date') from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Birth' limit 1), date_of_birth),
        wedding_date = coalesce((select icon_date(s->>'date') from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Marriage' limit 1), wedding_date),
        relationship = rel,
        baptized = coalesce(baptized, false) or exists (select 1 from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Baptism' and icon_date(s->>'date') is not null),
        confirmed = coalesce(confirmed, false) or exists (select 1 from jsonb_array_elements(coalesce(d->'special_dates','[]')) s where s->>'id' = 'Confirmation' and icon_date(s->>'date') is not null),
        status = st, icon_member_id = m.id
      where id = mid;
      n_upd_m := n_upd_m + 1;
    end if;
    -- Email: never change a portal login's email; never take an address another member already has
    if em is not null then
      if exists (select 1 from members where id = mid and auth_user_id is null and (email is null or lower(email) <> lower(em)))
         and not exists (select 1 from members where lower(email) = lower(em) and id <> mid) then
        update members set email = lower(em) where id = mid;
      elsif not exists (select 1 from members where id = mid and lower(coalesce(email,'')) = lower(em)) then
        n_email_skip := n_email_skip + 1;
      end if;
    end if;
  end loop;
  -- Linked members no longer in ICON → inactive
  update members set status = 'inactive'
   where icon_member_id is not null and status = 'active'
     and not exists (select 1 from icon_members im where im.id = members.icon_member_id);
  get diagnostics n_inact_m = row_count;

  -- 3) Contributions in the pulled date range
  for c in select ic.*, f.id as fam_id from icon_contributions ic left join families f on f.icon_household_id = ic.household_id loop
    if c.fam_id is null then n_c_skip := n_c_skip + 1; continue; end if;
    d := c.data;
    select id into ex from contributions where icon_id = c.id;
    if ex is null then
      insert into contributions (family_id, given_on, category, amount, method, reference, note, icon_id, source)
      values (c.fam_id, c.date_given, coalesce(d->>'fund_name', 'General'), icon_money(d->>'amount'), d->>'type', d->>'check_number', d->>'comment', c.id, 'icon');
      n_c_new := n_c_new + 1;
    else
      update contributions set family_id = c.fam_id, given_on = c.date_given, category = coalesce(d->>'fund_name', category),
        amount = icon_money(d->>'amount'), method = d->>'type', reference = d->>'check_number', note = d->>'comment', source = 'icon'
      where icon_id = c.id
        and (family_id, given_on, category, amount, coalesce(method,''), coalesce(reference,''), coalesce(note,''))
          is distinct from (c.fam_id, c.date_given, coalesce(d->>'fund_name', category), icon_money(d->>'amount'), coalesce(d->>'type',''), coalesce(d->>'check_number',''), coalesce(d->>'comment',''));
      if found then n_c_upd := n_c_upd + 1; end if;
    end if;
    total := total + icon_money(d->>'amount');
  end loop;
  -- Gifts corrected/removed in ICON within the range
  if p_from is not null and p_to is not null then
    delete from contributions
     where source = 'icon' and given_on between p_from and p_to
       and not exists (select 1 from icon_contributions ic where ic.id = contributions.icon_id);
    get diagnostics n_c_del = row_count;
  end if;

  -- 4) Pledges
  for p in select ip.*, f.id as fam_id from icon_pledges ip join families f on f.icon_household_id = ip.household_id loop
    d := p.data;
    select id into ex from pledges where icon_id = p.id;
    if ex is null then
      select id into ex from pledges where family_id = p.fam_id and year = nullif(d->>'fund_year','')::int and category = coalesce(d->>'fund_name','General') and icon_id is null;
    end if;
    if ex is null then
      insert into pledges (family_id, year, category, amount, icon_id)
      values (p.fam_id, coalesce(nullif(d->>'fund_year','')::int, extract(year from now())::int), coalesce(d->>'fund_name','General'), icon_money(d->>'pledge_total'), p.id)
      on conflict (family_id, year, category) do update set amount = excluded.amount, icon_id = excluded.icon_id;
    else
      update pledges set family_id = p.fam_id, amount = icon_money(d->>'pledge_total'), icon_id = p.id where id = ex.id;
    end if;
    n_p := n_p + 1;
  end loop;

  return jsonb_build_object(
    'households', jsonb_build_object('new', n_new_f, 'updated', n_upd_f, 'examples_new', samples_f),
    'members', jsonb_build_object('new', n_new_m, 'updated', n_upd_m, 'marked_inactive', n_inact_m, 'emails_not_changed', n_email_skip, 'examples_new', samples_m),
    'contributions', jsonb_build_object('new', n_c_new, 'changed', n_c_upd, 'removed', n_c_del, 'no_household', n_c_skip, 'total_amount', total, 'from', p_from, 'to', p_to),
    'pledges', n_p,
    'portal_totals', jsonb_build_object(
      'families', (select count(*) from families), 'members', (select count(*) from members),
      'contributions', (select count(*) from contributions), 'icon_contributions', (select count(*) from contributions where source = 'icon')));
end $$;

-- Public entry: dry runs apply everything inside a sub-transaction, then roll it back
create or replace function public.icon_merge(p_from date, p_to date, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; src text;
begin
  select source into src from icon_households limit 1;
  if src is distinct from 'live' then p_dry := true; end if;   -- test data never touches the register
  begin
    s := icon_merge_apply(p_from, p_to);
    if p_dry then raise exception using errcode = 'P0001', message = 'icon-dry-run'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'icon-dry-run' then return s || jsonb_build_object('dry_run', true, 'source', src); end if;
    raise;
  end;
  return s || jsonb_build_object('dry_run', false, 'source', src);
end $$;

revoke execute on function public.icon_merge_apply(date, date) from public, anon, authenticated;
revoke execute on function public.icon_merge(date, date, boolean) from public, anon, authenticated;

-- ---------- Nightly run (02:30 Eastern ≈ 06:30/07:30 UTC) ---------------
create or replace function public.icon_sync_tick()
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select value into k from public.app_secrets where key = 'cron';
  select net.http_post(
    url => 'https://lvdubjjhpzoembnlzfby.supabase.co/functions/v1/icon-sync',
    headers => jsonb_build_object('Content-Type','application/json','x-cron-key',k),
    body => jsonb_build_object('action', 'nightly'),
    timeout_milliseconds => 150000) into rid;
  return rid;
end $$;
revoke execute on function public.icon_sync_tick() from public, anon, authenticated;
select cron.schedule('icon-sync-nightly', '30 7 * * *', $$select public.icon_sync_tick()$$);

-- Directory: only active members (ICON can mark members inactive or deceased)
create or replace function public.member_directory()
returns table (first_name text, last_name text, family_name text, mobile_phone text, email text, prayer_group text)
language sql stable security definer set search_path = public as $$
  select m.first_name, m.last_name, f.family_name, m.mobile_phone, m.email, f.prayer_group
    from public.members m join public.families f on f.id = m.family_id
   where m.directory_opt_in and f.status = 'active' and m.status = 'active'
     and public.my_member_id() is not null
   order by m.last_name, m.first_name
$$;
