-- 005: small key/value store for dashboard settings that are not part of the rubric (Telegram chat, on/off).
-- RLS is on with no policy, so only the service-role key (server side) can read or write it.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
