-- =====================================================================
-- Mitra AI reference sources: a searchable copy of marthoma.in
-- (lectionary, Kalpanas/circulars, Sabha pages, news) plus extra pages
-- an admin adds. Filled by the edge function supabase/functions/mitra-sources.
-- =====================================================================

create table public.ref_docs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  kind         text not null,            -- circular | page | news | special_lectionary
  url          text not null unique,
  title        text,
  number       text,                     -- Kalpana number
  published_on date,
  content      text,
  text_status  text not null default 'pending',   -- pending | reading | ok | garbled | empty | failed | skipped
  fetched_at   timestamptz,
  tsv tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(number, '') || ' ' || coalesce(left(content, 200000), ''))) stored
);
create index ref_docs_tsv_idx on public.ref_docs using gin (tsv);
create index ref_docs_kind_idx on public.ref_docs (kind, published_on desc);

-- One row per Sunday / feast day from https://marthoma.in/prayer/
create table public.ref_lectionary (
  day            date primary key,
  title          text,
  songs          text,
  lessons        text,
  epistle_gospel text,
  evening        text,
  other          text,
  source_url     text,
  fetched_at     timestamptz not null default now()
);

create table public.ref_status (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Private values used only by the database itself (e.g. the scheduled-job key). No policies = no API access.
create table public.app_secrets (
  key   text primary key,
  value text not null
);

alter table public.ref_docs       enable row level security;
alter table public.ref_lectionary enable row level security;
alter table public.ref_status     enable row level security;
alter table public.app_secrets    enable row level security;

create policy ref_docs_officer_read on public.ref_docs       for select to authenticated using (public.is_officer());
create policy ref_lect_officer_read on public.ref_lectionary for select to authenticated using (public.is_officer());
create policy ref_status_officer_read on public.ref_status   for select to authenticated using (public.is_officer());

insert into public.app_secrets (key, value) values ('cron', encode(extensions.gen_random_bytes(24), 'hex'));

-- Keyword search used by the chat function
create or replace function public.ref_search(q text, n int default 5)
returns table (id uuid, kind text, title text, url text, number text, published_on date, content text, rank real)
language sql stable security definer set search_path = public as $$
  with words as (
    select distinct lower(w) as w
      from regexp_split_to_table(regexp_replace(coalesce(q, ''), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+') as w
     where length(w) >= 3
       and lower(w) not in ('the','and','for','what','when','where','which','who','whom','how','are','was','were','with','this','that','these','those','from','about','does','did','can','could','you','your','there','have','has','had','any','our','church','mar','thoma','please','tell','give','show','find','know','is','its','will','would','should','them','they','their','been','also','into','some','more','most','than','then','just','like','want','need','send','link','latest','recent','new','all')
  ), terms as (select string_agg(w || ':*', ' | ') as tq from words)
  select d.id, d.kind, d.title, d.url, d.number, d.published_on, left(d.content, 7000),
         ts_rank_cd(d.tsv, to_tsquery('simple', terms.tq)) as rank
    from public.ref_docs d, terms
   where terms.tq is not null and d.tsv @@ to_tsquery('simple', terms.tq)
   order by rank desc, d.published_on desc nulls last
   limit greatest(1, least(n, 10))
$$;

insert into public.portal_settings (key, value) values ('mitra_refs', '{"marthoma":true,"urls":[]}');

revoke execute on function public.ref_search(text, int) from public, anon, authenticated;
grant  execute on function public.ref_search(text, int) to service_role;

-- ---------------------------------------------------------------------
-- Schedule: full refresh hourly; Kalpana PDF text a few at a time every 10 minutes
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function public.mitra_sources_tick(p_mode text default 'all')
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select value into k from public.app_secrets where key = 'cron';
  select net.http_post(
    url => 'https://lvdubjjhpzoembnlzfby.supabase.co/functions/v1/mitra-sources',
    headers => jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_14hzkg5L28v8UxdrX3rKMA_aAcwEe5U','x-cron-key',k),
    body => jsonb_build_object('mode', p_mode),
    timeout_milliseconds => 150000) into rid;
  return rid;
end $$;
revoke execute on function public.mitra_sources_tick(text) from public, anon, authenticated;

select cron.schedule('mitra-sources-hourly', '7 * * * *', $$select public.mitra_sources_tick('all')$$);
select cron.schedule('mitra-sources-pdfs', '2,12,22,32,42,52 * * * *', $$select public.mitra_sources_tick('pdfs')$$);

-- The edge function mitra-sources is deployed with verify_jwt = false; it accepts either the
-- x-cron-key header above or a signed-in officer/admin (the "Refresh now" button in Admin).
