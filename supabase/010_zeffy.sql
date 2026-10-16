-- 010 — Online giving through Zeffy (zeffy.com, free for nonprofits).
-- Payments happen on the church's own Zeffy forms, which the site embeds:
--   donate_url   public donation form (Donate button in the main menu, /give/)
--   monthly_url  monthly subscription form (recurring; Zeffy charges the card each month)
--   other_url    anything else members pay for (an event, a fund, a shop)
-- Zeffy calls the zeffy-webhook edge function on every completed payment (including each monthly charge).
-- The webhook records it here and matches it to a family by email. When giving is NOT coming from ICON,
-- it also adds the payment to the family's contributions; in ICON mode the treasurer posts it in ICON
-- and the nightly ICON sync brings it in, so it isn't counted twice.

insert into public.portal_settings (key, value) values ('zeffy', jsonb_build_object(
  'donate_url', '', 'monthly_url', '', 'other_url', '',
  'monthly_category', 'Subscription',
  'monthly_note', 'Your monthly subscription is charged automatically each month. You can change or cancel it from the link in your Zeffy receipt email.',
  'other_note', 'Pay for an event, a special offering or anything else.'))
on conflict (key) do nothing;

create table if not exists public.zeffy_payments (
  id              text primary key,                 -- Zeffy payment id
  received_at     timestamptz not null default now(),
  paid_at         timestamptz,
  amount          numeric(12,2) not null,
  currency        text not null default 'usd',
  status          text not null default 'succeeded',
  email           text,
  name            text,
  campaign        text,
  kind            text not null default 'donation' check (kind in ('donation','monthly','other')),
  recurring       boolean not null default false,
  family_id       uuid references public.families(id) on delete set null,
  member_id       uuid references public.members(id) on delete set null,
  contribution_id uuid references public.contributions(id) on delete set null,
  raw             jsonb not null default '{}'
);
create index if not exists zeffy_payments_family on public.zeffy_payments (family_id, paid_at desc);
create index if not exists zeffy_payments_email  on public.zeffy_payments (lower(email));

alter table public.zeffy_payments enable row level security;
create policy zeffy_read_own on public.zeffy_payments for select to authenticated
  using (family_id is not null and family_id = public.my_family_id());
create policy zeffy_officer_read on public.zeffy_payments for select to authenticated using (public.is_officer());
create policy zeffy_officer_match on public.zeffy_payments for update to authenticated
  using (public.is_officer()) with check (public.is_officer());
revoke insert, update, delete, truncate on public.zeffy_payments from anon, authenticated;
grant update (family_id) on public.zeffy_payments to authenticated;   -- officers can match a payment by hand

-- Shared secret that Zeffy sends with each webhook (?token=…). Lives only in the database.
insert into public.app_secrets (key, value)
select 'zeffy_webhook', encode(extensions.gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_secrets where key = 'zeffy_webhook');

-- The URL to paste into Zeffy → Settings → Integrations → Webhooks (admins only).
create or replace function public.zeffy_webhook_url() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can see the Zeffy webhook address.'; end if;
  return 'https://lvdubjjhpzoembnlzfby.supabase.co/functions/v1/zeffy-webhook?token='
         || (select value from public.app_secrets where key = 'zeffy_webhook');
end $$;
revoke execute on function public.zeffy_webhook_url() from public, anon;
grant execute on function public.zeffy_webhook_url() to authenticated;

-- Post a matched, successful payment to the family's contributions (once) — unless ICON is the source of giving.
-- Runs when the webhook records a payment and when an officer matches one to a family by hand.
create or replace function public.zeffy_post_contribution() returns trigger
language plpgsql security definer set search_path = public as $$
declare s jsonb; cid uuid;
begin
  if new.family_id is null or new.contribution_id is not null or new.status <> 'succeeded' or new.amount <= 0 then return new; end if;
  if coalesce((select (value->>'giving_from_icon')::boolean from portal_settings where key = 'icon'), false) then return new; end if;
  select value into s from portal_settings where key = 'zeffy';
  insert into contributions (family_id, given_on, category, amount, method, reference, note, source)
  values (new.family_id, (coalesce(new.paid_at, new.received_at) at time zone 'America/New_York')::date,
          case when new.kind = 'monthly' then coalesce(nullif(s->>'monthly_category', ''), 'Subscription') else coalesce(new.campaign, 'Online gift') end,
          new.amount, 'Online (Zeffy)', left(new.id, 40), case when new.kind = 'monthly' then 'Monthly subscription' end, 'zeffy')
  returning id into cid;
  new.contribution_id := cid;
  return new;
end $$;
revoke execute on function public.zeffy_post_contribution() from public, anon, authenticated;
create trigger zeffy_post_contribution before insert or update of family_id on public.zeffy_payments
  for each row execute function public.zeffy_post_contribution();
