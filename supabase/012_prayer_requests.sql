-- =====================================================================
-- Prayer requests from the website (/prayer-request/). Private to the Vicar.
-- Written only by the prayer-request edge function. Anonymous requests store no name or contact details.
-- =====================================================================
create table public.prayer_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  status        text not null default 'new' check (status in ('new','prayed','followed_up','closed')),
  anonymous     boolean not null default false,
  name          text,
  email         text,
  phone         text,
  for_whom      text,
  request       text not null,
  share_ok      boolean not null default false,
  wants_contact boolean not null default false,
  email_status  text,
  notes         text,
  handled_at    timestamptz
);
create index prayer_requests_created_idx on public.prayer_requests (created_at desc);
alter table public.prayer_requests enable row level security;

insert into public.portal_settings (key, value) values
  ('prayer', '{"enabled":true,"recipients":["vicar@mtcatlanta.org"],"viewers":["vicar@mtcatlanta.org"]}')
on conflict (key) do nothing;

-- Only members whose login email is in settings.prayer.viewers can read / update requests (not every officer or admin)
create or replace function public.can_view_prayer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where m.auth_user_id = auth.uid() and m.email is not null
      and lower(m.email) in (select lower(v) from public.portal_settings s, jsonb_array_elements_text(coalesce(s.value->'viewers', '[]'::jsonb)) v where s.key = 'prayer')
  )
$$;
grant execute on function public.can_view_prayer() to authenticated;
revoke execute on function public.can_view_prayer() from public, anon;

create policy prayer_viewer_read   on public.prayer_requests for select to authenticated using (public.can_view_prayer());
create policy prayer_viewer_update on public.prayer_requests for update to authenticated using (public.can_view_prayer()) with check (public.can_view_prayer());
