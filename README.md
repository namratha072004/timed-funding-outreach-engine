# Outreach: Timed Funding Outreach Engine

Every morning this app finds startups that announced a **seed or pre-seed** round in the last 24 hours, checks them against an editable thesis, finds a contact email, and saves one personalised **draft** email per fitting startup into Rohit's Gmail Drafts folder. A dashboard shows the drafts for review. **It never sends email.**

All AI is **Gemini Flash only**. Gemini reads articles and marks criteria; **code** adds up the score and decides pass or reject.

## How it works

```
cron / Run now -> run lock -> RSS feeds -> keyword filter (code) -> memory check
  -> Gemini: read + mark each criterion (quote required) -> code: gates + score + decide
  -> (pass only) Hunter email, else contact page -> Gemini: write draft -> code: check the draft rules
  -> save to Supabase + Gmail draft -> dashboard -> Rohit reviews, edits, sends from Gmail
```

- **Trigger**: Vercel Cron calls `GET /api/run` with `Authorization: Bearer $CRON_SECRET` (Vercel sends it automatically when `CRON_SECRET` is set) at `30 3 * * *` UTC = 09:00 IST. The dashboard's **Run now** button calls `POST /api/run` with the access cookie.
- **Run guard**: a lease lock in `run_lock` (one atomic UPDATE) lets only one run happen at a time; a second caller logs "skipped: already running". A run uses concurrency 3, stops starting new work after 240 s (Hobby limit is 300 s), and obeys the per-run caps in `rubric_settings`.
- **Memory**: every article (by canonical URL) and startup (by cleaned name and verified domain) is remembered. Repeats are skipped before any AI call. A Gemini error leaves the article retryable.
- **Scoring**: yes = 1, partial = 0.5 (only where allowed), no = 0, unclear = 0. `score = sum(weight x points) / sum(active weights) x 100`. Pass needs the stage gate, the recency gate, no `reject_on_no` criterion marked "no", and `score >= pass_mark`. Every "yes" or "partial" must carry a quote that really appears in the article, or it is downgraded to "unclear".
- **Email**: Hunter.io verified addresses first (capped per run), else addresses on the startup's own contact page (marked unverified). The Gmail **To** is filled only for Hunter-verified addresses.
- **Draft rules, enforced in code**: at most 150 words; no funding promise; no mention of a 30-60 day window; empty settings show as `[PLACEHOLDERS]`; the chosen contact must come from the supplied list; inferred points are listed separately. One retry, then `draft_failed`.

## Pages

`/unlock` (access code), **Review** (`/`), **Rejected**, **Runs & health**, **Rubric**, and a draft detail page. Rejected startups never appear in Review.

## Setup

1. Supabase: the rubric tables already exist. Review and run `supabase/migrations/002_app_tables.sql` in the SQL editor (idempotent).
2. `cp .env.example .env.local` and fill it in.
3. `npm install`

### Environment variables (names only)

| Name | Purpose |
|---|---|
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (unused by server code) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only; RLS is on with no public policy |
| `GEMINI_API_KEY` | Gemini key |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_MODEL` | primary Flash model id, e.g. `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODELS` | optional, comma-separated Flash ids used when a model's daily quota is spent or it is overloaded |
| `GEMINI_SEARCH_ENABLED` | `false` (grounding is optional and off) |
| `HUNTER_API_KEY` | Hunter.io |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Gmail OAuth, scope `gmail.compose` only |
| `CRON_SECRET` | bearer token for the cron call |
| `ACCESS_CODE` | the dashboard access code (used when testing mode is off) |
| `ACCEPT_ANY_ACCESS_CODE` | `true` = testing mode, the unlock page accepts any non-empty code; `false` = enforce `ACCESS_CODE` |

## How Rohit edits the rubric (no code change)

In Supabase, edit and save:

- `rubric_settings`: `pass_mark`, `lookback_hours`, `allowed_stages`, `thesis_sectors`, `thesis_geographies`, `max_round_size_usd`, `hunter_lookups_per_run`, `max_articles_per_run`, `max_gemini_calls_per_run`, `funding_keywords`, `points`.
- `rubric_criteria`: weights, questions, `reject_on_no`, `allows_partial`, `active`.
- `outreach_settings`: `sender_name`, `accelerator_name`, `program_description`, `call_to_action`, `style_notes`. Empty values appear in drafts as `[SENDER NAME]`-style placeholders.
- `feeds`: add, remove or deactivate news feeds.

The next run uses the new values. Each edit bumps `rubric_meta.version`; previously rejected startups are re-scored (by code, from their saved marks) when it changes.

## Run locally

```bash
npm run dev          # http://localhost:3000
npm run build && npx next start -p 3100
```

## Checks and tests

| Command | What it does |
|---|---|
| `npm test` | unit tests: scoring, gates, reject_on_no, dedupe, quote verification, SSRF, draft rules, Gemini retry and fallback |
| `npm run typecheck` | TypeScript |
| `npm run check:services` | Supabase, Gemini, Hunter, Gmail (creates and deletes a test draft), feeds |
| `npm run check:rubric` | loads the live rubric and prints it |
| `npm run test:calibration` | 8 real articles, each scored twice at temperature 0; compares decisions and marks |
| `npm run test:lock` | concurrent lock acquisition: exactly one winner |
| `npm run test:access` | needs a running server: cron route and dashboard reject unauthenticated requests |
| `npm run test:e2e` | needs a running server: three live runs (168 h, 24 h, 168 h); proves no duplicate drafts; restores `lookback_hours` |
| `npm run scan:secrets` | searches the tree and the build output for any secret value |

## Deploy (Vercel)

Import the GitHub repo, set the environment variables above for Production, deploy. `vercel.json` registers the cron. Vercel sends `CRON_SECRET` as the bearer token automatically.

## Honest limitations

- **Gemini free-tier quota**: the key in use is on a free plan with 20 requests per day per model. A full run needs up to 40 calls, so the build rotates through fallback Flash models. Turn on billing for a steady daily run.
- **`gemini-3.x-flash` ids are preview or new models** and Google may change or retire them; the model is an env setting, so switching needs no code change.
- **Google Search grounding is not enabled** (quota error on this key); only RSS feeds are used.
- **Vercel Hobby**: the cron can fire up to an hour late, and a run has 300 s, so big backlogs are spread over several days by the per-run caps.
- **Fit judgement is Gemini's reading of one article.** Calibration shows where it is more generous than the reference marks (see the calibration section of the build report).
- **Hunter free tier is 50 lookups a month**; the default cap is 2 per run, so the worst case exceeds it. The code also checks the live account quota and falls back to the contact page.
- **Email addresses from contact pages are unverified**; they are shown, never put in Gmail's To.
- **SSRF protection** validates every connection's resolved address and every redirect; it cannot protect against a malicious site that simply serves misleading text.
- **A run cut off by Vercel at 300 s** shows as "did not finish"; its unprocessed work is retried next run.
