# DECISIONS

Every judgement call made while building, with a one-line reason. Where the build prompt was silent or the world differed from it, it is listed here.

## Platform and limits
- **Vercel Hobby plan, 300 s max duration** (docs: vercel.com/docs/functions/limitations, page dated 2026-08-24). The run stops starting new work at 240 s, uses concurrency 3, and the lock lease is 360 s (max duration plus 60 s margin) so a crashed run frees itself.
- **Cron `30 3 * * *` UTC is kept**, but on Hobby Vercel may fire it anywhere in that hour (docs: "Per-hour (±59 min)"). Fine for a morning run; Pro would be exact.
- **`maxDuration = 300` on `/api/run`**: the Hobby ceiling; anything higher would be refused.
- **Per-run caps live in `rubric_settings`** (`max_articles_per_run` 30, `max_gemini_calls_per_run` 40), not env vars, so Rohit can change them without a deploy. The two cap env vars were removed.
- **Article reads stop when only a reserve of Gemini calls is left** (min(10, a quarter of the cap)), so passing startups can still get a draft in the same run.

## Gemini
- **Endpoint: `generativelanguage.googleapis.com/v1beta`**, not Vertex. The `AQ.` key is rejected by Vertex (project blocked) but works here. `GEMINI_BASE_URL` and `GEMINI_MODEL` stay env settings.
- **Free-tier quota is 20 requests per day per model.** Google's error text names it (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). A daily run needs up to 40 calls, so the client has `GEMINI_FALLBACK_MODELS` (comma-separated Flash ids): on a daily-quota 429 it moves to the next Flash model for an hour. Still Gemini Flash only. Enabling billing removes the need for this.
- **Per-minute 429 is retried on the same model**, honouring Google's "retry in Ns"; 503 retries twice and then hops to the next model if one is configured; backoff everywhere. (A first version wrongly treated per-minute 429s as daily; a unit test now covers it.)
- **Primary model `gemini-3.5-flash`, fallbacks 3.6, 3.7, 3.8.** All answered a schema-constrained JSON request correctly once every field was marked `required`. The earlier "dropped field" problem with newer ids was my schema, not the models. `gemini-3-flash-preview` had used up its daily quota during calibration.
- **Google-Search grounding stays off** (`GEMINI_SEARCH_ENABLED=false`): it returned 429 on this key and the spec says the app must work without it. No grounding code path was built beyond the check script.
- **Temperature 0 for read-and-score; 0.3 for draft writing** (a little variety so drafts do not read identically).
- **Calibration pins one model** (fallbacks switched off) so it compares a model with itself.

## Scoring and gating (code, not Gemini)
- **A `partial` on a criterion that does not allow it counts as `unclear`** (0 points), the conservative reading of "partial only where allows_partial".
- **`unclear` on sector or geography does not hard-reject** (your instruction). It scores 0 for that criterion.
- **A "seed" or "pre-seed" stage label without a verbatim quote becomes "unclear"**, held to the same standard as the criterion marks.
- **The score is stored for passes and soft rejects; hard-rule rejects store `score = null`** so the Rejected tab shows "hard rule".
- **Round-size ceiling (`max_round_size_usd`) is enforced** when set and the amount is known in USD; `amount_usd` is only filled when the article states dollars (no currency conversion by Gemini).
- **Unknown publication date**: the page's own meta date is tried first; if still unknown it reaches the recency gate and is rejected with "date unknown" (an audit trail, rather than silently dropping it).

## Memory, dedupe and re-scoring
- **Layers**: canonical URL (before AI) -> guessed startup name from the headline (articles merged into one Gemini call) -> name key and verified domain after extraction -> unique index on `startups.domain` and unique `drafts.startup_id`.
- **Startup insert**: the domain index is partial, so `ON CONFLICT` cannot target it through the API. The code inserts, and on unique violation (23505) reads back the winning row. Drafts use a true upsert with ignore-duplicates, then read back.
- **A startup's website only counts if its domain appears in the article text or the article's links** and it is not the publisher or a social site. Otherwise `domain` is null and dedupe falls back to the name key. Gemini cannot invent a domain.
- **A name match with a different known domain is treated as a different company** (two firms can share a name).
- **Rejected startups are re-scored by code from their saved marks** (no AI, no new calls) when `rubric_meta.version` changes. If one now passes it is queued for a draft.
- **`startups.status = queued_overrule` means "passed, waiting for a draft"**: used for fresh passes, overrules and re-scored passes alike. A run cut off mid-draft therefore resumes next run.
- **Articles filtered only for age are re-checked on later runs** (code only, last 30 days), so widening `lookback_hours` later still finds them without any duplicate risk. Keyword rejects are final.
- **Articles that error (Gemini, fetch) stay retryable**; only `processed` articles are skipped.
- **Roundups and multi-startup articles** are marked processed with "not a single-startup announcement" (Gemini decides this with a flag; code acts on it).

## Email and drafts
- **Hunter first (verified = status "valid" only), contact page second, never both.** The homepage is always read for personalisation. Robots.txt is honoured for every page of the startup site.
- **Hunter runs only if the account still has quota** (a free account call at run start) and the per-run cap is not hit.
- **If Gemini picks no contact but contacts exist, code picks one** (verified first). Whatever is picked is always from the supplied list.
- **`to_email` is stored for unverified emails too** (the dashboard shows it flagged); the **Gmail To header is filled only when `email_source = verified`**.
- **Draft rules enforced in code**: <= 150 words; regexes for funding promises; regex for the 30/60-day window and the word "window"; every empty outreach value must appear as its visible placeholder; chosen contact must be in the list or null; no email address may appear that was not supplied. One retry with the problem list, then `draft_failed`.
- **A failed draft stays retryable**: the startup stays `queued_overrule`, the `drafts` row is `draft_failed` with the reason in `body` (there is no error column), and the next run tries again.
- **`gmail_draft_id` stores `draftId:messageId`** so the dashboard can deep-link to the draft in Gmail.
- **Gmail failure** sets `pending_gmail` on both the draft and the startup; the next run creates the Gmail draft from the saved text without calling Gemini again.
- **Nothing in the code can send.** OAuth scope is `gmail.compose`; the only Gmail call is `drafts.create`.

## Dashboard and access
- **`GET /api/run` accepts only the cron bearer token; `POST` accepts the bearer or the access cookie.** A GET could be triggered by a link or image, so the cookie is not honoured there. Vercel Cron uses GET with the bearer.
- **Access cookie holds a SHA-256 of the code, not the code**; `httpOnly`, `sameSite=lax`, and `secure` in production only (so local http testing works). Failed unlocks wait 600 ms.
- **Access is enforced twice**: `proxy.ts` (Next 16's name for middleware) and again in the app layout and every API handler.
- **Times are shown in IST**, stored in UTC.
- **Review list shows draft rows only; rejected startups have no draft row**, so they cannot appear there. Sent and skipped cards fade and move down.
- **"Preview" opens the email in a dialog; "Open draft" opens the detail page** (a page, not a side panel, so links to a draft work).
- **Services status on Runs & health is a live check on page load** (Gemini model list, Supabase, Gmail token, Hunter account) with a 6 s timeout each; none of them spends Gemini quota.
- **Hunter monthly usage is summed from `runs.counts.hunter_lookups`**; no separate table.
- **Run now** starts the run in one request and the modal polls `/api/run/status` every 1.5 s, showing the steps the run itself wrote.
- **A run that started but never finished (function cut off) is flagged** with a banner and a "did not finish" chip.

## Process
- **Keyword list** is my starter set (20 words) and matched as whole words, case-insensitive; `pre-seed` also matches "pre seed".
- **Calibration texts are cached locally in `scripts/calibration/cache/` (gitignored)**: it makes the two runs read identical text, and avoids republishing news articles.
- **GLAAS and Gharbar sources**: GLAAS's YourStory and IBS pages block bots (403), so the StartupTalky article is used. The only Gharbar page I could find is a thin Legal Suvidha post whose date is doubtful; it is used because no better source turned up, and flagged here.
- **The end-to-end test makes real Gmail drafts** (never sends). They will have placeholders in the sender/accelerator slots because `outreach_settings` is still empty. Delete them in Gmail if you do not want them.
- **No git repo was created** (you said you would make the GitHub repo); `.gitignore` is in place and `npm run scan:secrets` checks the tree and the build output for secret values.

## Added during testing
- **Gemini key and model**: KEY3 from `.env.keys.local` (the other two returned 401) is now `GEMINI_API_KEY`; it took 25 quick calls with no 429. Model `gemini-3-flash-preview`, fallbacks `gemini-3.5-flash,gemini-3.6-flash`. `.env.keys.local` was deleted.
- **Thinking level "low" (`GEMINI_THINKING_LEVEL`, `off` to disable) and a fixed `seed`** on scoring calls: calls went from about 90 s to about 3 s, which is what lets a run finish inside Hobby's 300 s. Before this, run 1 took 318 s.
- **Hard run deadline for Gemini**: no call starts, retries or waits after 270 s; the run itself stops starting work at 240 s.
- **Quote check ignores punctuation and quote or dash styles and accepts "..." quotes** when every piece of 12+ characters is in the text. Curly apostrophes and non-breaking hyphens were causing false "unclear" marks.
- **Article text extraction**: if a page has no usable `<article>`/`<main>`, only paragraph-like lines are kept, so menus cannot push the story past the size cap.
- **Website discovery**: outbound links are taken from the article body only. If the article names no site, name-based domains (`name.com/.in/.ai/.io/.co`) are tried and accepted only if the homepage contains the startup's name. A guessed site is contact-page only (To stays blank); Hunter is used only for a domain the article itself evidences.
- **Editing `lookback_hours` bumps the rubric version**, so rejected startups are re-scored (by code) after each edit; that is expected, not a bug.
- **Access code is in testing mode (your request)**: the unlock page stays, is labelled "(testing mode: any access code is accepted)", and accepts any non-empty code (`ACCEPT_ANY_ACCESS_CODE=true`). It still sets the cookie, so the dashboard is only reachable through the unlock page. Set the flag to `false` to enforce `ACCESS_CODE` again. The cron route is unchanged: `GET /api/run` still needs the bearer token.
- **Email rules (your clarification)**: "verified" means Hunter's own verifier says valid with a score of 100, and only such Hunter addresses are used at all (others are dropped). The only other source is the startup's own website (homepage, /contact, /contact-us, /about, robots.txt honoured), and those addresses are always marked unverified ("Check the email first") with To left blank. Gemini never supplies an address.
- **Every article is read (your instruction).** The keyword filter and the age filter before Gemini are removed (the code in `lib/filter.ts` stays but is unused). The rubric's recency gate and stage gate decide after reading, so an article older than `lookback_hours` is read and then rejected with "older than 24h". The per-run caps in `rubric_settings` are raised to 2000. The only real limit left is the 240 s time budget (Hobby's ceiling is 300 s): unread articles are picked up by the next run or the next click.
- **Every run reads every article currently in the feeds (your instruction, scheduled and manual alike).** There is no "already read, skip" memory for articles any more; memory now only protects drafts: a startup that is already known is recognised after reading and is never drafted twice. Reading goes 8 articles at a time, newest first, and stops at 170 s so drafting keeps time inside Hobby's 300 s limit; anything not reached is read first thing next run. This costs one Gemini call per article per run.
- **No time window (your instruction).** `lookback_hours` is `null` in `rubric_settings`: the recency gate is skipped entirely (no "older than Nh", and an unknown publish date is no longer a rejection). Because the setting changed, the rubric version bumped and earlier "older than 24h" rejections were re-scored by code from their saved marks; any that now pass are queued for drafting. To bring a window back, set `lookback_hours` to a number (for example 24).
- **Time window restored to 24 hours (your correction).** `lookback_hours` is 24 again; the recency gate checks it after reading, as before. (An earlier step had set it to none; that was reverted before any run used it.)
- **Scheduling moved to GitHub Actions, every 3 hours** (`.github/workflows/pipeline.yml`, cron `0 */3 * * *` UTC, plus a manual "Run workflow" button). Vercel Hobby only allows one cron a day, so the Vercel cron was removed from `vercel.json`. The workflow calls `GET /api/run` with the bearer token (GitHub secrets `CRON_SECRET` and `APP_URL`); a 409 (lock held by another run) counts as success.
- **Scheduled runs read only articles not read yet; the manual Run now button reads everything.** Reading every article every 3 hours would be about 290 Gemini calls per run, around 2,300 a day. New articles are all that a 3-hourly check needs, and dedupe (article URL, startup name and domain, one draft per startup) prevents duplicates. Set `READ_ALL_ON_SCHEDULE=true` in Vercel to make scheduled runs read everything too.
- **GitHub caveats**: scheduled workflows can start a few minutes late, and GitHub switches them off after 60 days without repository activity (re-enable in the Actions tab).
- **The 24 h window is applied before reading (speed).** Reading all ~290 articles took ~110 s because each needs a Gemini call, and no concurrency level made it faster. An article older than `lookback_hours` is always rejected by the recency gate, so the run now skips reading it (counted as "outside the window"); the outcome is the same as read-then-reject, with about a fifth of the calls. Articles with an unknown date are still read. The recency gate stays in the rubric code as the final check. With `lookback_hours = null` nothing is skipped.
- **The run is a chain of stages, each its own function invocation (your instruction).** `/api/run` takes the lock, creates the run and answers at once (HTTP 202); it starts the *ingest* stage in the background. Ingest fetches the feeds, saves articles and builds the queue; *read* stages each work through the queue for up to 230 s and then start a fresh invocation of themselves until the queue is empty; *draft* stages do the same for drafting. Every invocation has its own 300 s Hobby allowance, so nothing has to fit in one. Progress (queue, counts, steps) is saved in the `runs` row; each stage renews the lock lease; if a stage cannot start the next one the run is marked as an error and the lock is freed. The earlier tricks made only to fit 300 s are gone: no skipping articles outside the window before reading, no 170 s read cut-off, no article caps in effect.
- **Run status for GitHub Actions**: `/api/run/status?runId=` also accepts the bearer token, so the workflow can start a run and watch it to the end.

## Dashboard redesign (Review and Runs)
- Review now opens with a five-step funnel (articles read, funding announcements, startups found, fit the thesis, drafts in Gmail) and a "How the emails were found" card (Hunter verified, startup's own website, not found, plus Hunter usage). Numbers are live totals from the tables, so a run that finds nothing new never blanks the page.
- Each draft row says how its email was found. Runs & health shows read, funding news, new startups, fit, rejected, repeats skipped and the email split per run. Hunter usage comes from Hunter's own account figure, with the per-run count as a fallback.
- Depth is a small hover tilt, soft shadows and a count-up on load. All of it switches off when the visitor prefers reduced motion. No new dependencies.

## Design and settings update (dashboard rebuilt to match design/Dashboard_Preview_Clean_Layout.html)
Every decision below was made without asking; each can be changed.

**Access**
- Every page and `GET /api/run/status` is public. Everything that changes data needs the access cookie: Run now, Overrule, Save changes, moving a draft. `proxy.ts` now covers only `/api/*` and refuses any API call without the cookie (or, for `/api/run*`, the cron bearer token); each route checks again itself. `/api/unlock` stays open because it is the code check.
- The code is compared with `ACCESS_CODE` on the server (SHA-256 of both, constant-time compare). **Testing mode is kept, on your instruction** (I had removed it because the brief said to make the check real): with `ACCEPT_ANY_ACCESS_CODE=true` any non-empty code unlocks writes, and the code dialog shows "(testing mode: any access code is accepted)". With the flag false or unset, `ACCESS_CODE` is enforced and an empty `ACCESS_CODE` unlocks nothing.
- The unlock page is replaced by a dialog that opens when a write gets a 401, then repeats the action once. The cookie lasts 12 hours (it was 30 days).
- The run status API no longer returns the lock holder or internal queue, and old step text that contained a holder id is stripped.

**Pages**
- `/` is Today (welcome, sidebar hidden on this page only). The greeting follows Indian time: "Good morning" until 12:00, "Good afternoon" until 17:00, "Good evening" after, because scans now run every 3 hours; the preview's wording is the morning case. Its three stats are live totals (drafts waiting, rejected startups, articles read and active feeds).
- The funnel and "how the emails were found" cards from the previous version are removed, because the preview has no place for them. The same facts remain: each draft card shows the Hunter-verified / unverified / not-found pill and a Contact line saying where the address came from; Runs & health shows Hunter usage (Hunter's own figure, cached 5 minutes, because the page is now public); Sources shows articles per feed and outcome. The hover tilt, count-up and shadows are also removed to match the preview.
- The "services OK / down" card on Runs & health is removed: the page is public, and checking Gemini, Gmail and Hunter on every page view would spend credentials on anyone's visit.
- Draft detail pages are gone; the card on `/drafts` shows everything. Palette cookie `palette` (default Aurora) and theme cookie `theme`; with no theme cookie the system theme is used (set before first paint by a tiny inline script).
- Draft tabs: To review = new, pending_gmail, draft_failed. Approved = approved. Done = done, sent, skipped. `004_draft_tabs_and_et_startups.sql` adds `approved` and `done` to the `drafts.status` check. "Mark done" writes `done`; the app never sends mail. Sorted by fit score, then newest.
- The To line shows the address for both verified and unverified drafts, with "Left blank in the Gmail draft" under unverified ones; the Gmail To is still filled only for Hunter-verified addresses (unchanged).
- Rejected "When" is the announcement time (first article's publish time, else when we first saw the startup). "Announced" filter: last 24 hours or 7 days on that time. Rejected shows the first 500 by decision time.
- Colour, spacing and type: tokens in `app/globals.css`; the `lib/design.test.ts` test checks 4.5:1 contrast for 19 text/background pairs in all six palettes in light and dark, that only three font sizes exist, that gradients appear only on the primary button, the logo, the first welcome stat and the glow, and the 1000 px column. Run against the preview's own colours, the test fails for all six light palettes (dark ones pass), mostly muted text on tinted backgrounds, white text on the lighter end of the Aurora gradient and the Aurora accent on its tint (green muted text on white-ish was 4.1:1, on its tint 3.8:1). I darkened the muted and accent colours of the light palettes a little, and the Aurora light gradient; dark palettes are as in the preview. The loading skeleton uses a flat pulse, not a gradient.
- On phones tables turn into stacked rows (each cell shows its label); no page scrolls sideways (`npm run screenshots` checks this at 390 px).

**Sources: how each article's outcome is derived (no new columns)**
| Outcome | Rule |
|---|---|
| Error | `articles.status = 'error'` |
| Not read yet | `articles.status` is `new` (an addition to the six in the brief; articles exist in this state between ingest and read) |
| Not funding news | read (`processed`) with no linked startup (`startup_id` is null) |
| Merged | linked to a startup, but not that startup's first article (earliest `published_at`, unknown dates last, then lowest id). Includes repeats of a startup found in an earlier scan |
| Too old | first article of a startup rejected with reason `older than Nh` or `date unknown` |
| Rejected | first article of a startup with any other reject reason (shown in plain words) |
| Drafted | first article of a startup that is drafted, pending Gmail, or queued for a draft |
- Feed table: Status is OK if the feed has an article first seen in the last 3 days, "Nothing new in 3 days" if not, "Not read yet" with no stored articles, "Paused" if inactive. Median delay is median(first_seen_at - published_at) over stored articles.
- **Funding words no longer gate anything.** You told me earlier to read every article and let the rubric judge, so the keyword filter was removed from the pipeline. The chips are still editable (Run settings) and are used only for the Sources page's "Passed keyword filter" count, and the help text says so. If you want them to gate reading again, that is a one-line change in `lib/run.ts`.
- **Articles per run is now enforced** (it was stored but unused): the read queue is cut to the newest N; the rest stay unread for a later scheduled run. The live value is 2000, so nothing changes today. Gemini calls per run and email lookups per run were already enforced. Ranges: articles 1-2000, Gemini calls 1-2000, lookups 0-10 (the preview showed 1-200 and 1-10; 2000 is the live value, so it had to fit).

**ET Startups feed**
- ET's official RSS directory (economictimes.indiatimes.com/rss.cms) lists Tech > Startups at `https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570540.cms`. The existing "ET Entrepreneur" row (`.../small-biz/startups/rssfeeds/11993034.cms`) is a different feed: the directory lists it as SME > Entrepreneurship. So it was not renamed; the new feed was tested (HTTP 200, 50 items parsed by the app's parser) and inserted as "ET Startups" with on-conflict-do-nothing (also in migration 004).
- Not changed, but worth knowing: the existing row "ET Tech Startups" points at `.../tech/startups/rssfeeds/78570561.cms`, and the directory lists id 78570561 as Tech & Internet (`/tech/technology/rssfeeds/78570561.cms`). Its name is probably wrong; renaming would break the link to its stored articles' `source`, so I left it.

**Settings saves**
- `PUT /api/settings/rubric` and `/api/settings/run` validate on the server (`lib/settings.ts`): weights total 100 and each 0-100, one weight per active criterion, pass mark 0-100, sectors/countries/stages non-empty, stages limited to pre-seed and seed, look-back one of 6/12/24/36/48/72/168, caps in range, funding words non-empty; lists trimmed, spaces collapsed and de-duplicated (case-insensitive, first spelling kept), at most 50 items of 120 characters. Only rows whose value changed are written, so an unchanged save writes nothing and moves no version.
- A save that changes several scoring values moves the version once per changed row (the trigger is per row), so "Saved as version N" shows the final number and it can be more than one higher than before.
- "At N, X of Y startups would reach Drafts" uses the scores (not hard-rule rejects) of the startups first seen during the run that produced the newest scored startup, and is recomputed in the browser as the pass mark changes.

**Version trigger (migration 003)**
- `rubric_touch()` bumps `rubric_meta.version` only for scoring settings (allowed_stages, pass_mark, points, max_round_size_usd, thesis_sectors, thesis_geographies) and real changes to `rubric_criteria`. Writing the same value again is not a change. `updated_at` is still set on every change. Consequence: widening the look-back no longer makes the pipeline re-check startups that were rejected as too old; use Overrule for those.
- Checked against the live database in a transaction that was rolled back (the DO block raised an error at the end): start v16; lookback 24 to 48: v16 (updated_at moved); keywords, Hunter, articles and Gemini caps changed: v16; pass mark 65 to 70: v17 (+1); same pass mark again: v17; criteria no-op: v17; criteria weight 30 to 31: v18; thesis_sectors: v19; allowed_stages: v20. Afterwards the live values were read back: version 16, lookback 24, pass mark 65, Hunter 2, sector weight 30, articles 2000, 20 funding words, stages pre-seed and seed.

## Settings, Account, option lists and Telegram (your later requests)
- **Rubric is now Settings.** `/settings` has two tabs: Rubric (the same editable form) and Notifications. `/rubric` redirects to it. Run limits and funding words stay on Runs & health, as in the brief. Settings and Account are at the bottom left of the sidebar (and wrap into the top row on a phone).
- **Account** is a profile and sign-in page, not separate logins: there is one shared access code. It shows "Rohit", whether this browser is signed in or viewing only, and lets you enter the code (the same dialog) or sign out (clears the cookie). It also shows the Telegram state. If you want real per-person accounts with their own passwords, that is a bigger change (a users table and a login flow); say so and I will plan it.
- **Sectors and Countries are picked from lists** (24 sectors, 130 countries in `lib/options.ts`); choosing one adds it at once, and the list hides what is already chosen. Values already saved that are not on the list (none today) would still show. The server still accepts any text, so a custom value can be added through the API or Supabase.
- **Telegram reminders.** After a run finishes and wrote at least one draft, one message goes to Rohit's Telegram: how many new drafts, the startup names with stage and amount (up to 8), and a link to Drafts. No email addresses and no draft text. At most one message per run (the run records `telegram_notified`), and a failed send never fails the run. The bot token is the environment variable `TELEGRAM_BOT_TOKEN` and is never shown, stored in the database or put into an error message (error text is scrubbed). The chat to write to and an on/off switch are stored in the new table `app_settings` (migration 005, RLS on, no policy). Settings > Notifications has Connect Telegram (finds the chat of whoever pressed Start in the bot most recently, saves it and says hello there), Send test message, an on/off switch and Disconnect; all need the access code.
- In testing mode anyone who knows the bot's username could message it first and then press Connect to point reminders at their own chat; the reminders hold startup names only. Turn testing mode off to prevent that.
