-- =====================================================================
-- Website chat assistant: usage limits + settings
-- =====================================================================

-- Per-visitor and site-wide message counters (hashed IPs only; no message text is stored)
create table public.chat_usage (
  bucket       text not null,          -- 'ip:<hash>' or 'site'
  window_start timestamptz not null,   -- start of the hour (ip) or day (site)
  count        int not null default 0,
  primary key (bucket, window_start)
);
alter table public.chat_usage enable row level security;   -- no policies: only the chat function (service role) touches it

-- Count one message; returns false when the limit for that window is used up
create or replace function public.chat_hit(p_bucket text, p_window timestamptz, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.chat_usage (bucket, window_start, count) values (p_bucket, p_window, 1)
  on conflict (bucket, window_start) do update set count = chat_usage.count + 1
  returning count into n;
  return n <= p_limit;
end $$;

insert into public.portal_settings (key, value) values
  ('chat', '{"enabled":true,"greeting":"Hi! I’m Mitra AI, the assistant for Mar Thoma Church, Atlanta. Ask me about service times, upcoming events, our organizations or how to reach the church office.","hourly_limit":30,"daily_site_limit":1500}');

revoke execute on function public.chat_hit(text, timestamptz, int) from public, anon, authenticated;
grant  execute on function public.chat_hit(text, timestamptz, int) to service_role;

-- The assistant itself is the edge function in supabase/functions/chat (deployed as "chat").
-- It needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
