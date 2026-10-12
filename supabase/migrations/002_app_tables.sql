-- 002_app_tables.sql
-- Timed Funding Outreach Engine: app tables.
-- Idempotent: safe to run more than once. Do not recreate the rubric_* / outreach_settings tables (they exist).
-- RLS is enabled on every table with NO policy: only the service-role key (server-side) can read or write.

-- ---------------------------------------------------------------- feeds
create table if not exists public.feeds (
  id          bigint generated always as identity primary key,
  name        text not null,
  url         text not null unique,
  kind        text not null default 'rss' check (kind in ('rss', 'atom', 'sitemap')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- startups
create table if not exists public.startups (
  id               bigint generated always as identity primary key,
  name             text not null,
  name_key         text not null,                 -- cleaned: lowercase, no punctuation or legal suffixes
  domain           text,
  website          text,
  sector           text,
  location         text,
  stage_label      text check (stage_label in ('pre-seed', 'seed', 'other', 'unclear')),
  amount_text      text,
  amount_usd       numeric,
  investors        jsonb not null default '[]'::jsonb,
  founders         jsonb not null default '[]'::jsonb,
  description      text,
  status           text not null check (status in ('rejected', 'drafted', 'pending_gmail', 'queued_overrule')),
  reject_reason    text,
  reject_quote     text,
  score            numeric,
  marks            jsonb,
  rubric_version   integer,
  first_seen_at    timestamptz not null default now(),
  decided_at       timestamptz
);
-- One startup per domain (only when a domain is known).
create unique index if not exists startups_domain_uniq on public.startups (domain) where domain is not null;
create index if not exists startups_name_key_idx on public.startups (name_key);
create index if not exists startups_status_idx on public.startups (status);

-- ---------------------------------------------------------------- articles
create table if not exists public.articles (
  id             bigint generated always as identity primary key,
  canonical_url  text not null unique,            -- repeats are skipped before any AI call
  title          text,
  source         text,
  published_at   timestamptz,                     -- null = date unknown
  first_seen_at  timestamptz not null default now(),
  text_hash      text,
  status         text not null default 'new' check (status in ('new', 'filtered_out', 'processed', 'error')),
  error          text,
  startup_id     bigint references public.startups (id) on delete set null
);
create index if not exists articles_status_idx on public.articles (status);
create index if not exists articles_first_seen_idx on public.articles (first_seen_at desc);

-- ---------------------------------------------------------------- drafts
create table if not exists public.drafts (
  id               bigint generated always as identity primary key,
  startup_id       bigint not null unique references public.startups (id) on delete cascade,  -- one draft per startup, ever
  to_email         text,
  email_source     text not null default 'none' check (email_source in ('verified', 'unverified', 'none')),
  contacts         jsonb not null default '[]'::jsonb,
  subject          text,
  body             text,
  inferred_points  jsonb not null default '[]'::jsonb,
  gmail_draft_id   text,
  status           text not null default 'new' check (status in ('new', 'sent', 'skipped', 'pending_gmail', 'draft_failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists drafts_status_idx on public.drafts (status);

-- ---------------------------------------------------------------- runs
create table if not exists public.runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'ok' check (status in ('ok', 'skipped', 'error')),
  counts        jsonb not null default '{}'::jsonb,
  errors        jsonb not null default '[]'::jsonb,
  source_delays jsonb not null default '{}'::jsonb
);
create index if not exists runs_started_idx on public.runs (started_at desc);

-- ---------------------------------------------------------------- run_lock (single row, lease)
create table if not exists public.run_lock (
  id            smallint primary key default 1 check (id = 1),
  locked_until  timestamptz not null default '-infinity',
  holder        text
);
insert into public.run_lock (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- RLS: on, no public policy
alter table public.feeds     enable row level security;
alter table public.startups  enable row level security;
alter table public.articles  enable row level security;
alter table public.drafts    enable row level security;
alter table public.runs      enable row level security;
alter table public.run_lock  enable row level security;

-- ---------------------------------------------------------------- seed: editable funding keywords
-- rubric_settings columns: key, value (jsonb), description, updated_at
-- Note: your rubric_meta trigger may bump the rubric version on this insert; that only means
-- previously rejected startups can be re-scored once.
insert into public.rubric_settings (key, value, description)
values (
  'funding_keywords',
  '["seed","pre-seed","preseed","raises","raised","funding","funds","secures","secured","bags","bagged","backed","angel round","investment","invests","led by","crore","lakh","million","mn"]'::jsonb,
  'Keyword filter (code, before any AI): an article must contain at least one of these words as a whole word (case-insensitive) in its title or summary to be read. Rohit edits this list.'
)
on conflict (key) do nothing;

-- Per-run caps (editable). Leftover articles are picked up on the next run.
insert into public.rubric_settings (key, value, description) values
  ('max_articles_per_run', '30'::jsonb,
   'Most new articles read by Gemini in one run, so a run fits inside the Vercel function time limit. Leftovers are processed next run. Rohit may change it.'),
  ('max_gemini_calls_per_run', '40'::jsonb,
   'Most Gemini calls (read and score, plus draft writing) in one run. Protects the key quota. Leftovers are processed next run. Rohit may change it.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- seed: feeds (all four verified returning items)
insert into public.feeds (name, url, kind) values
  ('Inc42',           'https://inc42.com/feed/',                                                          'rss'),
  ('YourStory',       'https://yourstory.com/feed',                                                       'rss'),
  ('Entrackr',        'https://entrackr.com/rss',                                                         'rss'),
  ('ET Entrepreneur', 'https://economictimes.indiatimes.com/small-biz/startups/rssfeeds/11993034.cms',    'rss')
on conflict (url) do nothing;
