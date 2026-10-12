# Design and settings update: Timed Funding Outreach Engine

## ROLE
You are a senior product engineer and designer working in the existing Next.js project in this folder. You make careful, small, tested changes. You never break the pipeline.

## TASK
Update the dashboard to match the reference preview `design/Dashboard_Preview_Clean_Layout.html` (open it in a browser, click through every page, light and dark, and the Palette dropdown). Then add editable settings and the other changes below. Do not change scoring logic, dedupe, Gemini, Gmail or Hunter code. Work through everything in one go, make decisions yourself, write assumptions to DECISIONS.md, and stop only if you are truly blocked.

## CONTEXT
- The preview is the visual and content reference. Copy its layout, spacing, wording and behaviour. It uses sample data; the real app must use live Supabase data.
- Palette: use the "Aurora" palette (default, dark first) with a matching light mode. Put all colours in CSS variables so light and dark are two token sets. Keep the status colours: mint for good/verified/OK, amber for warnings, pink-red for rejected. Gradients only on the primary button, the logo text, the first stat on the welcome page and the glow. Never put a gradient under email text or quotes.
- Existing tables: rubric_settings, rubric_criteria, rubric_gates, outreach_settings, rubric_meta, feeds, articles, startups, drafts, runs, run_lock. Settings live in Supabase; the dashboard becomes a second way to edit them.

## CHANGES (all required)

### 1. Access model
- All pages are public and read-only. Only the actions that change data need the access code: Run now, Overrule, Save changes (Rubric and Run settings), moving a draft between tabs.
- Remove any "testing mode: any access code is accepted" text. The code check must be real (compare against ACCESS_CODE on the server).
- /api/run still needs the cron bearer token for scheduled runs.
- Add one line to README.md: the dashboard is publicly viewable and shows draft emails and contact addresses taken from public news, Hunter and company contact pages.

### 2. Welcome page (the first page, "Today")
Greeting "Good morning, Rohit." with today's date, three stats from live data (drafts ready, startups skipped, articles read and from how many sources), a primary "Let's get started" button that opens Drafts, and the line "Nothing is ever sent without you." with a link to Sources. The sidebar is hidden on this page only. A gentle fade-up animation on load, switched off for prefers-reduced-motion.

### 3. Top bar on every page
Brand, a status line "Last run <time ago> · <status> · <n> new, <n> drafted" linking to Runs & health, a Palette dropdown (keep Aurora, Green, Slate blue, Indigo, Terracotta, Plum), and a Dark/Light toggle. Default to the system theme, remember the choice in a cookie, not localStorage.

### 4. Drafts
Tabs To review / Approved / Done with counts, and buttons to move a draft between them (needs the code). Each card shows: startup, stage, amount, sector, location, announced time, fit score; To, Email source pill (Hunter verified, or "Unverified: check before sending", or "No address found"), Subject, First reported by; a Sources box listing every article (publisher tag, headline as a link, published time, and "Same startup, N articles merged into one draft" when merged) and a Contact line saying where the email came from; the draft body with [PLACEHOLDERS] highlighted; a "Why it passed (quotes from the article)" expander; "Open Gmail draft". Sort To review by fit score, then newest.

### 5. Rejected
Filter row (Sector, Announced, Reported by), table with Startup, Reason (with the quote), Score, When, and an Overrule button (needs the code). Include the article link and publisher tag.

### 6. Sources (new tab)
A feed table (Feed, Status, Articles read, Passed keyword filter, Median delay) and a list of every article the last scan read, with filters for Source and "What happened". Outcomes: Drafted, Rejected (with reason), Merged, Not funding news, Too old, Error. Derive outcomes from existing fields (articles.status, linked startup, published_at, first_seen_at); document the mapping in DECISIONS.md. Add ET Startups as a source: find ET's official startups RSS feed, report the exact URL, check whether it is the same feed as the existing "ET Entrepreneur" row (economictimes.indiatimes.com/small-biz/startups/rssfeeds/11993034.cms); if the same, rename that row to "ET Startups"; if different, test it and insert it into `feeds` with on-conflict-do-nothing. Never guess a URL.

### 7. Runs & health
Stat tiles, recent runs table, then editable Run settings: Articles per run, Gemini calls per run, Email lookups per run (these map to the existing rubric_settings keys), and the funding words as removable chips with an add box. Plain-English help text under each, as in the preview.

### 8. Rubric (editable)
Sections exactly as in the preview: Pass mark (with the live line "At N, X of today's startups would reach Drafts", computed from the real scores of the last run); the five criteria with weights, a share bar, a running total "100 / 100 ✓", and a "Reject straight away if clearly 'no'" checkbox on sector and geography; Sectors and Countries as chips with add/remove; Stages as checkboxes (pre-seed, seed); Look-back window dropdown (6, 12, 24, 36, 48, 72, 168 hours). A sticky bar shows "No unsaved changes" or "You have unsaved changes" with Discard and Save changes. Save needs the access code and shows "Saved as version N. Applies from the next run."

### 9. Server-side validation on every save (do not rely on the browser)
Reject a save if: weights do not total 100 or any is outside 0-100; pass mark is outside 0-100; sectors, countries or stages are empty; look-back is not one of the allowed values; caps are outside their ranges; funding words are empty. Return a clear error message the UI shows. Trim and de-duplicate list items.

### 10. Version trigger fix (database)
Add `supabase/migrations/003_rubric_version_scoring_only.sql` and apply it. The `rubric_touch()` trigger function must bump `rubric_meta.version` only when a scoring setting changes: rubric_settings keys allowed_stages, pass_mark, points, max_round_size_usd, thesis_sectors, thesis_geographies; or any change in rubric_criteria. Changes to lookback_hours, hunter_lookups_per_run, funding_keywords, max_articles_per_run and max_gemini_calls_per_run must NOT bump it (they still set updated_at). Keep `set search_path = public`. Verify inside a transaction that you roll back: editing lookback_hours leaves the version unchanged; editing pass_mark bumps it by 1. Restore every value afterwards.

## FORMAT
Reusable components (PageHeader, FilterBar, Card, EmptyState, ChipList, SaveBar, StatusPill) instead of per-page styling. Small diffs. Update README.md and DECISIONS.md.

## CONSTRAINTS
- 8px spacing scale, one max content width (about 1000px) centred, page title top-left and actions top-right, one card style everywhere, text left and numbers right in tables, at most three text sizes per page.
- Works at 390px phone width with no horizontal scroll, on all pages, in light and dark.
- Text contrast at least 4.5:1 in both modes.
- Service-role key stays server-side only. RLS stays on with no public policy. Secret scan stays at 0 hits. No emails are ever sent. Do not print key values.
- Keep every existing test green. Add tests for: server-side validation, the access rules (public read, protected writes), and the version trigger behaviour.

## EVALUATE
1. Run npm test, npm run typecheck, next build, test:access, scan:secrets. Fix anything that fails.
2. Take screenshots of Welcome, Drafts, Rejected, Sources, Runs & health and Rubric in dark and light at 1280px and 390px, using seeded sample rows only locally. Compare each with the preview and fix differences.
3. Confirm the version trigger behaviour with real output.
4. Report: file list, test and scan output, screenshots, every assumption, and anything you could not verify. Then list what I still do by hand (GitHub, Vercel env vars, redeploy).
