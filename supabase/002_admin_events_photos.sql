-- =====================================================================
-- Mar Thoma Church, Atlanta — admin area, events, photo sharing, settings
-- Runs after schema.sql.
-- =====================================================================

-- ---------- Roles ------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where auth_user_id = auth.uid() and role = 'admin')
$$;
grant execute on function public.is_admin() to authenticated;

-- Only admins may hand out officer/admin roles (SQL editor / service role is unrestricted)
create or replace function public.guard_member_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if (tg_op = 'INSERT' and new.role <> 'member')
       or (tg_op = 'UPDATE' and new.role is distinct from old.role) then
      raise exception 'Only an admin can change portal roles';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger members_guard_role before insert or update on public.members
  for each row execute function public.guard_member_role();

-- ---------- Officers/admins manage parish records ---------------------
create policy fam_admin      on public.families                 for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy mem_admin      on public.members                  for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy pledge_admin   on public.pledges                  for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy orgmem_admin   on public.organization_memberships for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy ann_admin      on public.member_announcements     for all to authenticated using (public.is_officer()) with check (public.is_officer());
create policy doc_admin      on public.member_documents         for all to authenticated using (public.is_officer()) with check (public.is_officer());

-- ---------- Announcements: members-only, public (home page), or both ---
alter table public.member_announcements
  add column audience   text not null default 'members' check (audience in ('members','public','both')),
  add column pinned     boolean not null default false,
  add column link_url   text,
  add column created_at timestamptz not null default now();

create policy ann_public_read on public.member_announcements for select to anon, authenticated
  using (audience in ('public','both') and published_on <= current_date
         and (expires_on is null or expires_on >= current_date));

-- ---------- Events calendar ---------------------------------------------
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  location     text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  category     text not null default 'Parish',
  published    boolean not null default true,
  members_only boolean not null default false,
  created_at   timestamptz not null default now()
);
create index events_starts_idx on public.events(starts_at);
alter table public.events enable row level security;

create policy events_public  on public.events for select to anon, authenticated using (published and not members_only);
create policy events_members on public.events for select to authenticated using (published and public.my_member_id() is not null);
create policy events_admin   on public.events for all to authenticated using (public.is_officer()) with check (public.is_officer());

-- ---------- Portal settings (what members see) ------------------------
create table public.portal_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.portal_settings enable row level security;
create policy settings_read  on public.portal_settings for select to anon, authenticated using (true);
create policy settings_admin on public.portal_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.portal_settings (key, value) values
  ('member_tabs', '{"overview":true,"profile":true,"family":true,"giving":true,"organizations":true,"directory":true,"documents":true,"photos":true,"account":true}'),
  ('photo_uploads', '{"enabled":true,"max_mb":10,"note":"Photos are reviewed by the church office before they appear in the gallery."}'),
  ('home', '{"announcements":true,"announcement_count":3,"events":true,"event_count":4}');

-- ---------- Member photo submissions -----------------------------------
create table public.photo_submissions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  storage_path    text not null unique,
  caption         text,
  event_name      text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  show_in_gallery boolean not null default true,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.members(id) on delete set null
);
create index photo_status_idx on public.photo_submissions(status, created_at desc);
alter table public.photo_submissions enable row level security;

create policy photos_own_read   on public.photo_submissions for select to authenticated
  using (member_id = public.my_member_id());
create policy photos_own_insert on public.photo_submissions for insert to authenticated
  with check (member_id = public.my_member_id() and status = 'pending'
              and coalesce((select (value->>'enabled')::boolean from public.portal_settings where key = 'photo_uploads'), true));
create policy photos_own_delete on public.photo_submissions for delete to authenticated
  using (member_id = public.my_member_id() and status = 'pending');
create policy photos_public_read on public.photo_submissions for select to anon, authenticated
  using (status = 'approved' and show_in_gallery);
create policy photos_admin on public.photo_submissions for all to authenticated
  using (public.is_officer()) with check (public.is_officer());

-- ---------- File storage ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('member-photos',    'member-photos',    false, 15728640, array['image/jpeg','image/png','image/webp','image/gif']),
  ('member-documents', 'member-documents', false, 26214400, null);

-- Photos: members upload into a folder named after their member id
create policy "photos: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = public.my_member_id()::text);
create policy "photos: read own or officer" on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and ((storage.foldername(name))[1] = public.my_member_id()::text or public.is_officer()));
create policy "photos: read approved" on storage.objects for select to anon, authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.photo_submissions p where p.storage_path = name and p.status = 'approved' and p.show_in_gallery));
create policy "photos: delete own pending or officer" on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and ((storage.foldername(name))[1] = public.my_member_id()::text or public.is_officer()));

-- Documents: officers upload; any linked member can read
create policy "docs: officers write" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-documents' and public.is_officer());
create policy "docs: officers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'member-documents' and public.is_officer());
create policy "docs: members read" on storage.objects for select to authenticated
  using (bucket_id = 'member-documents' and public.my_member_id() is not null);

-- ---------- Function permissions ---------------------------------------
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.guard_member_role() from public, anon, authenticated;
revoke execute on function public.link_auth_user() from public, anon, authenticated;
grant  execute on function public.link_auth_user() to supabase_auth_admin;

-- Portal access (invites, starting passwords) is handled by the edge function in
-- supabase/functions/admin-users, deployed to the project as "admin-users".
