-- =====================================================================
-- "New Members" form → Admin → New Members (and an email to the Vicar & Secretary)
-- Rows are written only by the new-member edge function (service role).
-- =====================================================================
create table public.new_member_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  status        text not null default 'new' check (status in ('new','contacted','added','declined')),
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  phone         text,
  address_line1 text, address_line2 text, city text, state text, zip text,
  family        jsonb not null default '[]',   -- [{first_name,last_name,relationship,date_of_birth}]
  wedding_date  date,
  home_parish   text,
  previous_parish text,
  moved_on      date,
  transfer_letter text,
  organizations text[] not null default '{}',
  message       text,
  heard_from    text,
  email_status  text,                          -- sent / failed: … / not configured
  staff_notes   text,
  handled_by    uuid references public.members(id) on delete set null,
  handled_at    timestamptz,
  family_id     uuid references public.families(id) on delete set null
);
create index new_member_requests_created_idx on public.new_member_requests (created_at desc);
alter table public.new_member_requests enable row level security;
create policy nmr_officer_read   on public.new_member_requests for select to authenticated using (public.is_officer());
create policy nmr_officer_update on public.new_member_requests for update to authenticated using (public.is_officer()) with check (public.is_officer());

insert into public.portal_settings (key, value) values
  ('new_members', '{"recipients":["vicar@mtcatlanta.org","secretary@mtcatlanta.org"],"enabled":true}')
on conflict (key) do nothing;
-- Edge function: supabase/functions/new-member (verify_jwt = false; origin allowlist, honeypot, 5/hour per visitor).
-- Emails go out through Resend (RESEND_API_KEY), from the newsletter "from" address, with reply-to = the applicant.
