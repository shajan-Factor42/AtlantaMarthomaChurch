-- =====================================================================
-- Flyer images for events and announcements, plus a details link on events
-- =====================================================================
alter table public.events add column if not exists flyer_url text;   -- full URL (uploaded) or a site path like assets/flyers/x.jpg
alter table public.events add column if not exists link_url text;    -- "Register / details" button
alter table public.member_announcements add column if not exists flyer_url text;

-- Public bucket: anyone can view flyers; only officers/admins upload, replace or delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flyers', 'flyers', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy flyers_officer_insert on storage.objects for insert to authenticated with check (bucket_id = 'flyers' and public.is_officer());
create policy flyers_officer_update on storage.objects for update to authenticated using (bucket_id = 'flyers' and public.is_officer());
create policy flyers_officer_remove on storage.objects for delete to authenticated using (bucket_id = 'flyers' and public.is_officer());
create policy flyers_officer_select on storage.objects for select to authenticated using (bucket_id = 'flyers' and public.is_officer());
