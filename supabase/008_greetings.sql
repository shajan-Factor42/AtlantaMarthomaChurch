-- =====================================================================
-- Birthday & wedding anniversary greetings (Admin → Greetings)
-- Editable templates live in portal_settings key 'greetings'. Emails go through Resend
-- from the "greetings" edge function — on demand from Admin, or each morning by pg_cron
-- when "Send automatically" is on.
-- =====================================================================

-- One row per greeting per year, so nobody gets the same greeting twice
create table public.greeting_deliveries (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('birthday','anniversary')),
  occasion_key text not null,              -- birthday: member id · anniversary: family id + wedding date
  year         int  not null,
  celebrant    text not null,              -- name(s), for the admin list
  emails       text[] not null default '{}',
  status       text not null check (status in ('sent','failed')),
  error        text,
  sent_by      text not null default 'admin',   -- 'admin' or 'auto'
  sent_at      timestamptz not null default now(),
  unique (kind, occasion_key, year)
);

-- People who asked not to receive greeting emails (separate from the newsletter list)
create table public.greeting_optouts (
  email      text primary key,   -- lower-case
  created_at timestamptz not null default now()
);

alter table public.greeting_deliveries enable row level security;
alter table public.greeting_optouts    enable row level security;
create policy greet_deliv_officer  on public.greeting_deliveries for select to authenticated using (public.is_officer());
create policy greet_optouts_officer on public.greeting_optouts   for all to authenticated using (public.is_officer()) with check (public.is_officer());

-- Default templates (edit in Admin → Greetings). Placeholders: {first_name} {name} {couple} {couple_first} {years} {church}
insert into public.portal_settings (key, value) values ('greetings', jsonb_build_object(
  'auto', false,
  'birthday', jsonb_build_object(
    'subject', 'Happy Birthday, {first_name}!',
    'message', E'Dear {first_name},\n\nOn behalf of the Vicar and the whole parish family of {church}, we wish you a very happy and blessed birthday!\n\n“The Lord bless you, and keep you. The Lord make his face to shine on you, and be gracious to you.” (Numbers 6:24–25)\n\nMay this new year of your life be filled with God’s grace, good health and joy.',
    'signoff', E'With love and prayers,\nRev. Jacob Thomas Anicad, Vicar\nand your {church} family',
    'image_url', null),
  'anniversary', jsonb_build_object(
    'subject', 'Happy Anniversary, {couple_first}!',
    'message', E'Dear {couple_first},\n\nWarmest congratulations on your {years} wedding anniversary! We thank God for the gift of your marriage and for all that you mean to our parish family.\n\n“Above all these things, walk in love, which is the bond of perfection.” (Colossians 3:14)\n\nMay the Lord continue to bless your home with His love, joy and peace.',
    'signoff', E'With love and prayers,\nRev. Jacob Thomas Anicad, Vicar\nand your {church} family',
    'image_url', null)
)) on conflict (key) do nothing;

-- Daily run (about 8 AM Eastern). The function only sends when "auto" is switched on.
create or replace function public.greetings_tick()
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select value into k from public.app_secrets where key = 'cron';
  select net.http_post(
    url => 'https://lvdubjjhpzoembnlzfby.supabase.co/functions/v1/greetings',
    headers => jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_14hzkg5L28v8UxdrX3rKMA_aAcwEe5U','x-cron-key',k),
    body => jsonb_build_object('action', 'auto'),
    timeout_milliseconds => 150000) into rid;
  return rid;
end $$;
revoke execute on function public.greetings_tick() from public, anon, authenticated;
select cron.schedule('greetings-daily', '20 12 * * *', $$select public.greetings_tick()$$);

-- Officers (e.g. the secretary) may edit the greeting templates; other settings stay admin-only
create policy settings_greetings_officer on public.portal_settings for all to authenticated
  using (key = 'greetings' and public.is_officer()) with check (key = 'greetings' and public.is_officer());
