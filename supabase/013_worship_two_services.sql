-- Two services every Sunday (English and Malayalam). A Sunday's change can list its own services.
alter table public.worship_services add column if not exists services jsonb;          -- [{time:"08:00", language:"English"}, …]; null = regular services
alter table public.worship_services add column if not exists no_service boolean not null default false;
update public.worship_services set no_service = true where language = 'No service';

-- Regular services: portal_settings.worship = {"services":[{"time":"08:00","language":"English"},{"time":"10:00","language":"Malayalam"}]}
update public.portal_settings
   set value = jsonb_build_object('services', '[{"time":"08:00","language":"English"},{"time":"10:00","language":"Malayalam"}]'::jsonb), updated_at = now()
 where key = 'worship';
