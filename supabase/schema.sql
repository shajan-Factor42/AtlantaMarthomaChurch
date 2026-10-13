-- =====================================================================
-- Mar Thoma Church, Atlanta — member portal database (Supabase / Postgres)
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists public.families (
  id            uuid primary key default gen_random_uuid(),
  family_name   text not null,                 -- e.g. "Varghese, Thomas & Mary"
  member_number text unique,                   -- parish register number
  address_line1 text,
  address_line2 text,
  city          text,
  state         text default 'GA',
  zip           text,
  home_phone    text,
  prayer_group  text,                          -- area / prayer group
  home_parish   text,                          -- parish in Kerala, if any
  member_since  date,
  status        text not null default 'active' check (status in ('active','inactive','visitor')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  first_name      text not null,
  last_name       text not null,
  email           text unique,                 -- login email (adults only)
  mobile_phone    text,
  date_of_birth   date,
  relationship    text default 'member',       -- head, spouse, son, daughter, parent…
  baptized        boolean,
  confirmed       boolean,                     -- Holy Communion / confirmation
  wedding_date    date,
  role            text not null default 'member' check (role in ('member','officer','admin')),
  directory_opt_in boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists members_family_idx on public.members(family_id);

create table if not exists public.contributions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  given_on    date not null,
  category    text not null,     -- Subscription, Sunday Offering, Thanksgiving, Mission, Building Fund…
  amount      numeric(10,2) not null check (amount >= 0),
  method      text,              -- Check, Zelle, Cash, Online
  reference   text,              -- check number etc.
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists contributions_family_date_idx on public.contributions(family_id, given_on);

create table if not exists public.pledges (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  year        int  not null,
  category    text not null default 'Subscription',
  amount      numeric(10,2) not null,
  unique (family_id, year, category)
);

create table if not exists public.organization_memberships (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete cascade,
  organization  text not null,   -- Sunday School, Yuvajana Sakhyam, Sevika Sangham, Choir…
  position      text,            -- Secretary, Teacher, Member…
  unique (member_id, organization)
);

create table if not exists public.member_announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  published_on date not null default current_date,
  expires_on   date
);

create table if not exists public.member_documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text default 'General',   -- Minutes, Annual Report, Forms, Budget…
  url          text not null,            -- link to Supabase Storage file or Google Drive
  published_on date not null default current_date
);

-- ---------- Helper functions -------------------------------------------

-- The member row for whoever is logged in
create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.members where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where auth_user_id = auth.uid() and role in ('officer','admin'))
$$;

-- When an invited person signs in for the first time, link their login to their member row by email
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.members set auth_user_id = new.id
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_auth_user();

-- Members may update only these fields of their own family and their own family members
create or replace function public.update_my_family(
  p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_zip text, p_home_phone text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.families set
    address_line1 = p_address_line1, address_line2 = p_address_line2, city = p_city,
    state = p_state, zip = p_zip, home_phone = p_home_phone, updated_at = now()
  where id = public.my_family_id();
end $$;

create or replace function public.update_family_member(
  p_member_id uuid, p_mobile_phone text, p_email text, p_date_of_birth date, p_directory_opt_in boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where id = p_member_id and family_id = public.my_family_id()) then
    raise exception 'Not allowed';
  end if;
  -- Changing a login email is handled by the office, so email only updates for members without a login
  update public.members set
    mobile_phone = p_mobile_phone,
    email = case when auth_user_id is null then nullif(p_email,'') else email end,
    date_of_birth = p_date_of_birth,
    directory_opt_in = p_directory_opt_in,
    updated_at = now()
  where id = p_member_id;
end $$;

grant execute on function public.update_my_family(text,text,text,text,text,text) to authenticated;
grant execute on function public.update_family_member(uuid,text,text,date,boolean) to authenticated;

-- ---------- Row Level Security -----------------------------------------
alter table public.families                 enable row level security;
alter table public.members                  enable row level security;
alter table public.contributions            enable row level security;
alter table public.pledges                  enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.member_announcements     enable row level security;
alter table public.member_documents         enable row level security;

-- Families: see your own; officers see all
drop policy if exists fam_read on public.families;
create policy fam_read on public.families for select to authenticated
  using (id = public.my_family_id() or public.is_officer());

-- Members: see your own family; officers see everyone
drop policy if exists mem_read on public.members;
create policy mem_read on public.members for select to authenticated
  using (family_id = public.my_family_id() or public.is_officer());

-- Parish directory: only members who opted in, and only contact fields (no birthdays etc.)
create or replace function public.member_directory()
returns table (first_name text, last_name text, family_name text, mobile_phone text, email text, prayer_group text)
language sql stable security definer set search_path = public as $$
  select m.first_name, m.last_name, f.family_name, m.mobile_phone, m.email, f.prayer_group
    from public.members m join public.families f on f.id = m.family_id
   where m.directory_opt_in and f.status = 'active'
     and public.my_member_id() is not null
   order by m.last_name, m.first_name
$$;
grant execute on function public.member_directory() to authenticated;

-- Contributions & pledges: your family only; officers see all
drop policy if exists contrib_read on public.contributions;
create policy contrib_read on public.contributions for select to authenticated
  using (family_id = public.my_family_id() or public.is_officer());

drop policy if exists pledge_read on public.pledges;
create policy pledge_read on public.pledges for select to authenticated
  using (family_id = public.my_family_id() or public.is_officer());

-- Officers/admins may add and correct records from the portal or the Supabase table editor
drop policy if exists contrib_write on public.contributions;
create policy contrib_write on public.contributions for all to authenticated
  using (public.is_officer()) with check (public.is_officer());

drop policy if exists orgmem_read on public.organization_memberships;
create policy orgmem_read on public.organization_memberships for select to authenticated
  using (member_id in (select id from public.members where family_id = public.my_family_id()) or public.is_officer());

-- Announcements & documents: any signed-in member
drop policy if exists ann_read on public.member_announcements;
create policy ann_read on public.member_announcements for select to authenticated
  using (public.my_member_id() is not null and (expires_on is null or expires_on >= current_date));

drop policy if exists doc_read on public.member_documents;
create policy doc_read on public.member_documents for select to authenticated
  using (public.my_member_id() is not null);

-- Nothing is readable without logging in (no policies for the anon role).

-- ---------- Function permissions ---------------------------------------
-- Only signed-in users may call the helper functions; anonymous visitors get nothing.
revoke execute on function public.my_member_id()       from public, anon;
revoke execute on function public.my_family_id()       from public, anon;
revoke execute on function public.is_officer()         from public, anon;
revoke execute on function public.member_directory()   from public, anon;
revoke execute on function public.update_my_family(text,text,text,text,text,text)   from public, anon;
revoke execute on function public.update_family_member(uuid,text,text,date,boolean) from public, anon;
grant  execute on function public.my_member_id()       to authenticated;
grant  execute on function public.my_family_id()       to authenticated;
grant  execute on function public.is_officer()         to authenticated;
