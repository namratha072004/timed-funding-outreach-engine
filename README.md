# Outreach: Timed Funding Outreach Engine

Every morning this app finds startups that announced a **seed or pre-seed** round in the last 24 hours, checks them against an editable thesis, finds a contact email, and saves one personalised **draft** email per fitting startup into Rohit's Gmail Drafts folder. A dashboard shows the drafts for review. **It never sends email.**

> The dashboard is publicly viewable and shows draft emails and contact addresses taken from public news, Hunter and company contact pages. Only actions that change data (Run now, Overrule, Save changes, moving a draft) ask for the access code.

All AI is **Gemini Flash only**. Gemini reads articles and marks criteria; **code** adds up the score and decides pass or reject.

## How it works

```
GitHub Actions / Run now -> run lock -> RSS feeds -> memory check
  -> Gemini: read + mark each criterion (quote required) -> code: gates + score + decide
  -> (pass only) Hunter email, else contact page -> Gemini: write draft -> code: check the draft rules
  -> save to Supabase + Gmail draft -> Telegram reminder to Rohit (new drafts only)
  -> dashboard -> Rohit reviews, edits, sends from Gmail
```

- **Trigger**: a GitHub Actions workflow (`.github/workflows/pipeline.yml`) calls `GET /api/run` with `Authorization: Bearer $CRON_SECRET` **every 3 hours** (Vercel Hobby only allows a daily cron, so Vercel Cron is not used). It needs the repo secrets `CRON_SECRET` and `APP_URL`. Scheduled runs read articles not read yet; the dashboard's **Run now** button (`POST /api/run`) reads every article in the feeds.
- **Telegram reminder**: when a run has written at least one new draft, one Telegram message tells Rohit (startup names and a link to Drafts, never email addresses or draft text). The bot token is `TELEGRAM_BOT_TOKEN`; the chat is connected from Settings > Notifications. The Today and Drafts pages tell visitors the reminder exists and whether it is on.
- **Run guard**: a lease lock in `run_lock` (one atomic UPDATE) lets only one run happen at a time; a second caller logs "skipped: already running". A run is a chain of stages (ingest, read, draft). Each stage is its own function invocation with its own 300 s Vercel Hobby allowance and starts the next one, so reading is not limited to what fits in 300 s.
- **Memory**: every article (by canonical URL) and startup (by cleaned name and verified domain) is remembered. Repeats are skipped before any AI call. A Gemini error leaves the article retryable.
- **Scoring**: yes = 1, partial = 0.5 (only where allowed), no = 0, unclear = 0. `score = sum(weight x points) / sum(active weights) x 100`. Pass needs the stage gate, the recency gate, no `reject_on_no` criterion marked "no", and `score >= pass_mark`. Every "yes" or "partial" must carry a quote that really appears in the article, or it is downgraded to "unclear".
- **Email**: Hunter.io verified addresses first (capped per run), else addresses on the startup's own contact page (marked unverified). The Gmail **To** is filled only for Hunter-verified addresses.
- **Draft rules, enforced in code**: at most 150 words; no funding promise; no mention of a 30-60 day window; empty settings show as `[PLACEHOLDERS]`; the chosen contact must come from the supplied list; inferred points are listed separately. One retry, then `draft_failed`.

## Design documents

- [`design/Components_Map.png`](design/Components_Map.png): the components map (actors, triggers, inputs, context, processing, AI, outputs), updated for GitHub Actions every 3 hours, editable Settings, the Gmail restore and the Telegram reminder. Source: `design/Components_Map.html`.
- [`design/Nine_Checks.png`](design/Nine_Checks.png): the nine checks, with the wording that changed marked UPDATED. Source: `design/Nine_Checks.html`.
- Re-render after editing a source: `node scripts/render-design.mjs design/Components_Map.html design/Components_Map.png 1900` and `node scripts/render-design.mjs design/Nine_Checks.html design/Nine_Checks.png 2400 1350`.

## Pages

All pages are public and read-only: **Today** (`/`, welcome, no sidebar), **Drafts** (`/drafts`, tabs To review / Approved / Done), **Rejected**, **Sources** (feeds and every article with what happened to it) and **Runs & health** (with editable run limits and funding words). **Settings** and **Account** sit at the bottom left: Settings has the editable **Rubric** and **Notifications** (Telegram); Account shows who is signed in and lets you enter the access code or sign out. A top bar on every page shows the last run, a palette dropdown (Aurora is the default) and a Dark/Light toggle; both choices are remembered in cookies, and with no cookie the system theme is used.

Actions that change data ask for the access code in a small dialog: Run now, Overrule, Save changes (Rubric and Run settings) and moving a draft between tabs. The code is checked on the server against `ACCESS_CODE`; the browser keeps only a hash of it in an httpOnly cookie for 12 hours. **Testing mode** (`ACCEPT_ANY_ACCESS_CODE=true`, the current setting) accepts any non-empty code and the dialog says so; set it to `false` to enforce `ACCESS_CODE`.

## Setup

1. Supabase: the rubric tables already exist. Run `supabase/migrations/002_app_tables.sql`, `003_rubric_version_scoring_only.sql`, `004_draft_tabs_and_et_startups.sql` and `005_app_settings.sql` in the SQL editor, in order (all idempotent).
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
| `ACCESS_CODE` | the code that unlocks actions which change data (Run now, Overrule, Save, moving drafts) |
| `TELEGRAM_BOT_TOKEN` | optional: token of the Telegram bot that sends the "new drafts are ready" reminder (the chat is connected from Settings > Notifications) |
| `ACCEPT_ANY_ACCESS_CODE` | `true` = testing mode, any non-empty code unlocks; `false` = enforce `ACCESS_CODE` |

## How Rohit edits the settings

On the dashboard, under **Settings > Rubric** (sectors and countries are picked from lists) (pass mark, the five weights, reject-straight-away for sector and geography, sectors, countries, stages, look-back window) and **Runs & health** (articles per run, Gemini calls per run, email lookups per run, funding words). Every save is checked on the server first (weights must total 100, lists cannot be empty, caps must be in range) and needs the access code. Changes apply from the next run.

The same values still live in Supabase and can be edited there: `rubric_settings`, `rubric_criteria`, `outreach_settings` (sender, accelerator, program, call to action; edited in Supabase only) and `feeds`.

`rubric_meta.version` moves only when something that changes scoring changes: the pass mark, points, stages, round-size limit, sectors, countries, or any criterion (migration `003`). Editing the look-back window, run caps or funding words does not move it, so it does not trigger a re-check of earlier rejects.

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
| `npm run test:access` | needs a running server: pages are public, every write is refused without the code, the code check is real, invalid saves are refused |
| `npm run test:settings` | saves today's live values back through the real save code: nothing is written and the version does not move |
| `npm run test:e2e` | needs a running server: three live runs (168 h, 24 h, 168 h); proves no duplicate drafts; restores `lookback_hours` |
| `npm run scan:secrets` | searches the tree and the build output for any secret value |

## Deploy (Vercel)

Import the GitHub repo, set the environment variables above for Production, deploy. The schedule lives in GitHub Actions, not Vercel. Add the repo secrets `CRON_SECRET` (same value as in Vercel) and `APP_URL` (your deployed URL).

## Honest limitations

- **Gemini free-tier quota**: the key in use is on a free plan with 20 requests per day per model. A full run needs up to 40 calls, so the build rotates through fallback Flash models. Turn on billing for a steady daily run.
- **`gemini-3.x-flash` ids are preview or new models** and Google may change or retire them; the model is an env setting, so switching needs no code change.
- **Google Search grounding is not enabled** (quota error on this key); only RSS feeds are used.
- **Vercel Hobby**: the cron can fire up to an hour late, and a run has 300 s, so big backlogs are spread over several days by the per-run caps.
- **Fit judgement is Gemini's reading of one article.** Calibration shows where it is more generous than the reference marks (see the calibration section of the build report).
- **Hunter free tier is 50 lookups a month**; the default cap is 2 per run, so the worst case exceeds it. The code also checks the live account quota and falls back to the contact page.
- **Email addresses from contact pages are unverified**; they are shown, never put in Gmail's To.
- **SSRF protection** validates every connection's resolved address and every redirect; it cannot protect against a malicious site that simply serves misleading text.
- **A stage cut off by Vercel at 300 s** is not expected (each stage stops itself at about 230 s and starts the next one). If a stage cannot start the next, the run is marked as failed and unread articles are read by the next run.
