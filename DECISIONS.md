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
