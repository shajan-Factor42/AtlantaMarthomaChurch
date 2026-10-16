-- =====================================================================
-- Newsletters (Admin → Newsletters): create from a template or upload a
-- PDF, then email it to members + a subscriber list through Resend.
-- =====================================================================

create table public.newsletters (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,                       -- "November 2026"
  period_start date,
  period_end   date,
  source       text not null default 'template' check (source in ('template','upload')),
  content      jsonb not null default '{}'::jsonb,  -- message, chosen events/announcements, extra sections
  pdf_path     text,                                -- path in the "newsletters" bucket
  pdf_url      text,                                -- public URL of the PDF
  status       text not null default 'draft' check (status in ('draft','sending','sent')),
  published    boolean not null default false,      -- listed on the website's Newsletters page
  sent_at      timestamptz,
  sent_count   int not null default 0,
  created_by   uuid references public.members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- People outside the register who want the newsletter (visitors, friends, former members)
create table public.newsletter_subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  name       text,
  source     text not null default 'admin',
  created_at timestamptz not null default now()
);
create unique index newsletter_subscribers_email on public.newsletter_subscribers (lower(email));

-- Anyone (member or subscriber) who clicked "unsubscribe"
create table public.newsletter_optouts (
  email      text primary key,   -- stored lower-case
  created_at timestamptz not null default now()
);

-- One row per email per newsletter, so a send can resume without duplicates
create table public.newsletter_deliveries (
  newsletter_id uuid not null references public.newsletters(id) on delete cascade,
  email         text not null,   -- lower-case
  status        text not null check (status in ('sent','failed')),
  error         text,
  sent_at       timestamptz not null default now(),
  primary key (newsletter_id, email)
);

alter table public.newsletters            enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_optouts     enable row level security;
alter table public.newsletter_deliveries  enable row level security;

create policy nl_public_read on public.newsletters for select to anon, authenticated using (published and pdf_url is not null);
create policy nl_officer     on public.newsletters for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy nl_subs_officer     on public.newsletter_subscribers for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy nl_optouts_officer  on public.newsletter_optouts     for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy nl_deliv_officer    on public.newsletter_deliveries  for select to authenticated using (public.is_officer());

-- Public bucket for the PDFs (they are emailed and listed on the website); only officers upload
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('newsletters', 'newsletters', true, 26214400, array['application/pdf'])
on conflict (id) do nothing;

create policy newsletters_officer_insert on storage.objects for insert to authenticated with check (bucket_id = 'newsletters' and public.is_officer());
create policy newsletters_officer_update on storage.objects for update to authenticated using (bucket_id = 'newsletters' and public.is_officer());
create policy newsletters_officer_remove on storage.objects for delete to authenticated using (bucket_id = 'newsletters' and public.is_officer());
create policy newsletters_officer_select on storage.objects for select to authenticated using (bucket_id = 'newsletters' and public.is_officer());

-- Secret used to sign unsubscribe links (read only by the edge functions' service role)
insert into public.app_secrets (key, value)
values ('newsletter_unsubscribe', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Sender details shown in Admin → Newsletters → Settings
insert into public.portal_settings (key, value)
values ('newsletter', jsonb_build_object(
  'from_name', 'Mar Thoma Church, Atlanta',
  'from_email', 'news@mtcatlanta.org',
  'reply_to', 'marthomachurchatlanta@gmail.com'))
on conflict (key) do nothing;
