-- =====================================================================
-- Worship: per-Sunday changes to the regular pattern (Admin → Worship)
-- =====================================================================
create table public.worship_services (
  day        date primary key,
  language   text check (language in ('Malayalam','English','Bilingual','Combined','No service')),
  time       time,
  note       text,
  celebrant  text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id) on delete set null
);
alter table public.worship_services enable row level security;
create policy worship_read  on public.worship_services for select to anon, authenticated using (true);
create policy worship_write on public.worship_services for all to authenticated using (public.is_officer()) with check (public.is_officer());

-- Regular pattern: time + language by Sunday of the month (admins edit in Admin → Worship)
insert into public.portal_settings (key, value) values
  ('worship', '{"time":"10:00","schedule":{"1":"Malayalam","2":"English","3":"Malayalam","4":"English","5":"Special"},"fifth_note":"See announcements"}')
on conflict (key) do nothing;

-- The Sabha lectionary (copied from marthoma.in) is public; the Worship page shows each Sunday's readings
create policy ref_lect_public_read on public.ref_lectionary for select to anon using (true);
create policy ref_lect_member_read on public.ref_lectionary for select to authenticated using (true);
