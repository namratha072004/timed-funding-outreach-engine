import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyNewDrafts } from "./telegram";
import { loadRubric } from "./config";
import { findWebsiteViaSearch, guessWebsite, hunterAccount, hunterContacts, readSite, verifyWebsite, type Contact } from "./contacts";
import { decide } from "./decide";
import { writeDraft } from "./draft";
import { readAndScore, type ArticleInput, type Extraction } from "./extract";
import { fetchFeed, type FeedItem, type FeedRow } from "./feeds";
import { isGoogleNewsLink, resolveGoogleNewsUrl } from "./googlenews";
import { Budget, geminiSearch, setGeminiDeadline } from "./gemini";
import { createGmailDraft } from "./gmail";
import { acquireLock, extendLock, LEASE_SECONDS, releaseLock } from "./lock";
import { claimDraft, claimStartup, findStartup, pool, type StartupRow } from "./memory";
import { safeFetchText } from "./ssrf";
import { articleText, domainOf, externalLinks, guessNameFromTitle, nameKey, publishedFromHtml } from "./text";
import type { Rubric } from "./types";

/**
 * A run is a chain of stages. Every stage is its own function invocation (its own 300 s Vercel Hobby allowance) and starts the next one:
 *   ingest  -> fetch feeds, save articles, re-score after a rubric change, build the queue of articles to read
 *   read    -> Gemini reads articles from the queue; repeats as a new invocation until the queue is empty
 *   draft   -> email lookup, draft writing, Gmail drafts; repeats until nothing is left to draft
 * Progress (queue, counts, steps) lives in the runs row, so no stage needs to fit the whole job.
 */
export type Stage = "ingest" | "read" | "draft";
/** Within one invocation: stop starting new work here (the hard limit is 300 s). */
export const STAGE_BUDGET_MS = Number(process.env.STAGE_BUDGET_SECONDS ?? 230) * 1000; // STAGE_BUDGET_SECONDS exists only for testing the chain
export const CONCURRENCY = 3; // drafting (email lookups, Gmail)
export const READ_CONCURRENCY = 16; // reading is mostly waiting on Gemini
const HOUR = 3_600_000;

export const STEPS = [
  { key: "lock", label: "Lock taken" },
  { key: "fetch", label: "Fetching news" },
  { key: "filter", label: "Listing articles" },
  { key: "memory", label: "Memory check" },
  { key: "read", label: "Gemini reads + scores" },
  { key: "decide", label: "Code decides" },
  { key: "email", label: "Email lookup (passes only)" },
  { key: "draft", label: "Gemini writes drafts" },
  { key: "save", label: "Saved" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
type StepRow = { key: StepKey; label: string; state: "pending" | "active" | "done"; detail: string };

type Row = Record<string, any>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/(key|token|secret)=[^&\s]+/gi, "$1=***").slice(0, 300);

/** Pure: what happens after a read stage? Keeps the chain from looping forever when nothing makes progress. */
export function nextAfterRead(o: { queueLeft: number; processedThisStage: number; stalls: number; budgetLeft: number }): { next: "read" | "draft"; stalls: number; dropQueue: boolean } {
  if (o.queueLeft === 0) return { next: "draft", stalls: 0, dropQueue: false };
  if (o.budgetLeft <= 0) return { next: "draft", stalls: 0, dropQueue: true }; // Gemini call budget used up
  const stalls = o.processedThisStage === 0 ? o.stalls + 1 : 0;
  return stalls >= 2 ? { next: "draft", stalls, dropQueue: true } : { next: "read", stalls, dropQueue: false };
}

/** Re-derive the decision for a stored startup from its saved marks (no AI). Used when the rubric version changes. */
export function decideStored(rubric: Rubric, s: Row, now: Date) {
  const m = s.marks ?? {};
  return decide({
    rubric,
    now,
    publishedAt: m.published_at ? new Date(m.published_at) : null,
    stageLabel: m.stage?.label ?? "unclear",
    stageQuote: m.stage?.quote ?? null,
    amountUsd: s.amount_usd ?? null,
    marks: m.criteria ?? {},
  });
}


const FRESH_COUNTS = {
  fetched: 0, new_articles: 0, filtered: 0, candidates: 0, read: 0, groups: 0, startups_new: 0, passed: 0, rejected: 0, drafted: 0,
  gmail_drafts: 0, duplicates: 0, not_announcements: 0, rescored: 0, errors: 0, gemini_calls: 0, hunter_lookups: 0, emails_verified: 0,
  emails_unverified: 0, emails_none: 0, downgraded_quotes: 0, deadline_hit: false, cap_hit: false, stages: 0,
};

/** Takes the lock and creates the run row. The caller then starts the first stage. */
export async function startRun(db: SupabaseClient, trigger: "cron" | "manual"): Promise<{ runId: number | null; status: "started" | "skipped" }> {
  const holder = `${trigger}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(db, holder))) {
    const { data } = await db.from("runs").insert({ status: "skipped", finished_at: new Date().toISOString(), counts: { reason: "skipped: already running", trigger } }).select("id").single();
    return { runId: data?.id ?? null, status: "skipped" };
  }
  const steps: StepRow[] = STEPS.map((s) => ({ ...s, state: "pending", detail: "" }));
  steps[0]!.state = "done";
  steps[0]!.detail = `lease ${LEASE_SECONDS}s`;
  const { data } = await db.from("runs").insert({ status: "ok", counts: { ...FRESH_COUNTS, trigger, holder, started_ms: Date.now(), queue: [], draft_done: [], stalls: 0, steps } }).select("id").single();
  return { runId: data?.id ?? null, status: "started" };
}

async function finishRun(db: SupabaseClient, runId: number, c: Row, steps: StepRow[], errors: string[], status: "ok" | "error") {
  c.duration_ms = Date.now() - (c.started_ms ?? Date.now());
  c.queue = [];
  if (status === "ok") steps.forEach((s) => (s.state = "done"));
  await db.from("runs").update({ finished_at: new Date().toISOString(), status, counts: { ...c, steps }, errors }).eq("id", runId);
  await releaseLock(db, c.holder);
}

/** Marks a run failed (a stage threw, or the next stage could not be started) and frees the lock. */
export async function failRun(db: SupabaseClient, runId: number, reason: string) {
  const { data } = await db.from("runs").select("counts,errors").eq("id", runId).single();
  if (!data) return;
  const errors: string[] = [...(data.errors ?? []), `run: ${reason}`.slice(0, 300)];
  const c = { ...data.counts, errors: (data.counts?.errors ?? 0) + 1 };
  const steps: StepRow[] = c.steps ?? [];
  delete c.steps;
  await finishRun(db, runId, c, steps, errors, "error");
}

/** Runs one stage and returns the stage to run next (null = the run is finished). */
export async function runStage(db: SupabaseClient, runId: number, stage: Stage): Promise<Stage | null> {
  const stageStart = Date.now();
  const deadline = stageStart + STAGE_BUDGET_MS;
  const late = () => Date.now() > deadline;
  setGeminiDeadline(stageStart + STAGE_BUDGET_MS + 40_000); // a started call may finish; nothing runs past ~270 s of this invocation's 300 s

  const { data: row, error: rowErr } = await db.from("runs").select("*").eq("id", runId).single();
  if (rowErr || !row) throw new Error("run not found");
  if (row.finished_at) return null; // already finished: a duplicate trigger does nothing
  const c: Row = { ...row.counts };
  const steps: StepRow[] = c.steps;
  delete c.steps;
  const errors: string[] = [...(row.errors ?? [])];
  c.stages = (c.stages ?? 0) + 1;
  await extendLock(db, c.holder);

  const addError = (e: string) => {
    c.errors++;
    if (errors.length < 50) errors.push(e);
  };
  let lastWrite = 0;
  const flush = async (force = false) => {
    if (!force && Date.now() - lastWrite < 2000) return;
    lastWrite = Date.now();
    await db.from("runs").update({ counts: { ...c, steps }, errors }).eq("id", runId);
  };
  const step = async (key: StepKey, detail: string, state: "active" | "done" = "done") => {
    const i = steps.findIndex((s) => s.key === key);
    steps.forEach((s, j) => {
      if (j < i && s.state !== "done") s.state = "done";
    });
    steps[i]!.state = state;
    steps[i]!.detail = detail;
    await flush(true);
  };

  const rubric = await loadRubric(db);
  const now = new Date();
  const budget = new Budget(rubric.maxGeminiCallsPerRun);
  budget.used = c.gemini_calls ?? 0;

  // feed items are needed only as a fallback text source and for the ingest stage; fetched lazily and once per invocation
  const { data: feedRows } = await db.from("feeds").select("*").eq("active", true).order("id");
  const publisherDomains = [...new Set((feedRows ?? []).map((f: Row) => domainOf(f.url)).filter(Boolean) as string[])];
  let feedItemsMemo: Promise<Map<string, FeedItem>> | null = null;
  const getFeedItems = (): Promise<Map<string, FeedItem>> =>
    (feedItemsMemo ??= (async () => {
      const m = new Map<string, FeedItem>();
      await pool((feedRows ?? []) as FeedRow[], 4, async (f) => {
        try {
          for (const it of await fetchFeed(f)) if (!m.has(it.url)) m.set(it.url, it);
        } catch (e) {
          if (stage === "ingest") addError(`feed ${f.name}: ${msg(e)}`);
        }
      });
      // Google search results link to a Google redirect page: swap in the publisher's real address (and drop what cannot be resolved)
      const viaGoogle = [...m.values()].filter((it) => isGoogleNewsLink(it.url)).slice(0, 90);
      if (viaGoogle.length) {
        await pool(viaGoogle, 6, async (it) => {
          m.delete(it.url);
          const real = await resolveGoogleNewsUrl(it.url);
          if (real && !m.has(real)) m.set(real, { ...it, url: real });
        });
      }
      return m;
    })());

  const textCache = new Map<string, { text: string; links: string[] }>();
  const loadArticle = async (a: Row): Promise<ArticleInput & { links: string[] }> => {
    let text = "";
    let links: string[] = [];
    try {
      const r = await safeFetchText(a.canonical_url, { maxBytes: 1_500_000, timeoutMs: 10_000 });
      if (r.status < 400 && /html|xml|text/i.test(r.contentType || "text/html")) {
        text = articleText(r.text);
        links = externalLinks(r.text, r.finalUrl, publisherDomains);
        if (!a.published_at) {
          const p = publishedFromHtml(r.text);
          if (p) {
            a.published_at = p.toISOString();
            await db.from("articles").update({ published_at: a.published_at }).eq("id", a.id);
          }
        }
      }
    } catch {
      /* fall back to the feed's own text below */
    }
    if (text.length < 600) {
      const item = (await getFeedItems()).get(a.canonical_url);
      const feedText = item ? (item.content.length > item.summary.length ? item.content : item.summary) : "";
      if (feedText.length > text.length) text = feedText;
    }
    if (text.length < 150) throw new Error("no readable article text");
    textCache.set(a.canonical_url, { text, links });
    return { url: a.canonical_url, title: a.title ?? "", source: a.source ?? "", text: text.slice(0, 14_000), links };
  };

  // =====================================================================================================================
  if (stage === "ingest") {
    // re-score rejected startups only if the rubric version changed (code only, no AI)
    {
      const { data } = await db.from("startups").select("*").eq("status", "rejected").neq("rubric_version", rubric.version).not("marks", "is", null);
      for (const s of data ?? []) {
        const d = decideStored(rubric, s, now);
        await db.from("startups").update(
          d.pass
            ? { status: "queued_overrule", reject_reason: null, reject_quote: null, score: d.score, rubric_version: rubric.version, decided_at: iso(now) }
            : { reject_reason: d.reason, reject_quote: d.quote, score: d.hardRule ? null : d.score, rubric_version: rubric.version, decided_at: iso(now) },
        ).eq("id", s.id);
        c.rescored++;
      }
    }

    await step("fetch", "reading feeds", "active");
    const feedItems = await getFeedItems();
    c.fetched = feedItems.size;
    const acc: Record<string, number[]> = {};
    const all = [...feedItems.values()];
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200);
      const { data, error } = await db
        .from("articles")
        .upsert(chunk.map((it) => ({ canonical_url: it.url, title: it.title, source: it.source, published_at: iso(it.publishedAt) })), { onConflict: "canonical_url", ignoreDuplicates: true })
        .select("canonical_url, published_at, first_seen_at, source");
      if (error) throw new Error(`saving articles: ${error.message}`);
      c.new_articles += data?.length ?? 0;
      for (const r of data ?? []) {
        if (r.published_at) {
          const h = (new Date(r.first_seen_at).getTime() - new Date(r.published_at).getTime()) / HOUR;
          if (h >= 0 && h < 24 * 14) (acc[r.source] ??= []).push(h);
        }
      }
    }
    const sourceDelays = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { avg_hours: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), n: v.length }]));
    await db.from("runs").update({ source_delays: sourceDelays }).eq("id", runId);
    await step("fetch", `${feedRows?.length ?? 0} feeds → ${c.fetched} items, ${c.new_articles} new`);

    // Which articles are read: manual "Run now" reads every article in the feeds (known startups are skipped after reading);
    // scheduled runs read only articles not read yet, so a 3-hourly run finds what is new. READ_ALL_ON_SCHEDULE=true reads everything.
    await step("filter", "listing articles", "active");
    const readAll = c.trigger === "manual" || process.env.READ_ALL_ON_SCHEDULE === "true";
    let candidates: Row[] = [];
    if (readAll) {
      const urls = [...feedItems.keys()];
      for (let i = 0; i < urls.length; i += 100) {
        const { data } = await db.from("articles").select("id,published_at").in("canonical_url", urls.slice(i, i + 100));
        candidates.push(...(data ?? []));
      }
    } else {
      const since = new Date(now.getTime() - 30 * 24 * HOUR).toISOString();
      const { data } = await db.from("articles").select("id,published_at").in("status", ["new", "error"]).gte("first_seen_at", since).limit(5000);
      candidates = data ?? [];
    }
    candidates.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    // "Articles per run" (Run settings). Newest first; the rest stay unread and a later scheduled run picks them up.
    const leftOver = Math.max(0, candidates.length - rubric.maxArticlesPerRun);
    candidates = candidates.slice(0, rubric.maxArticlesPerRun);
    c.queue = candidates.map((a) => a.id);
    c.candidates = candidates.length;
    await step("filter", `${c.fetched} articles in the feeds; ${candidates.length} to read (${readAll ? "all of them" : "new since the last run"}). Judged on the rubric, ${rubric.lookbackHours == null ? "no time window" : `${rubric.lookbackHours}h window`}`);
    await step("memory", `${candidates.length} articles queued${leftOver ? `, ${leftOver} more wait for a later run (articles-per-run setting is ${rubric.maxArticlesPerRun})` : ". Each stage runs as its own function, so reading is not limited by the 300 s function time"}`);
    await flush(true);
    return "read";
  }

  // =====================================================================================================================
  if (stage === "read") {
    const queue: number[] = [...(c.queue ?? [])];
    await step("read", `${c.read} of ${c.candidates} articles read`, "active");
    const rows: Row[] = [];
    for (let i = 0; i < queue.length; i += 100) {
      const { data } = await db.from("articles").select("*").in("id", queue.slice(i, i + 100));
      rows.push(...(data ?? []));
    }
    const byId = new Map(rows.map((a) => [a.id, a]));
    const groups = new Map<string, Row[]>();
    for (const id of queue) {
      const a = byId.get(id);
      if (!a) continue;
      const g = guessNameFromTitle(a.title ?? "");
      const key = g ? `n:${nameKey(g)}` : `u:${a.id}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    c.groups = (c.groups ?? 0) + groups.size;
    const done = new Set<number>();

    const processGroup = async (arts: Row[]) => {
      const finish = () => arts.forEach((a) => done.add(a.id));
      if (budget.left <= 0) return; // stays queued; nextAfterRead will drop it as "budget used up"
      const loaded: (ArticleInput & { links: string[] })[] = [];
      for (const a of arts) {
        try {
          loaded.push(await loadArticle(a));
        } catch (e) {
          await db.from("articles").update({ status: "error", error: msg(e) }).eq("id", a.id);
          addError(`article ${a.canonical_url}: ${msg(e)}`);
        }
      }
      if (!loaded.length) return finish();
      if (!budget.take()) return;
      c.read += loaded.length;
      steps.find((s) => s.key === "read")!.detail = `${c.read} of ${c.candidates} articles read`;
      await flush();
      let x: Extraction;
      try {
        x = await readAndScore(rubric, loaded, loaded.flatMap((l) => l.links));
      } catch (e) {
        // Gemini failure: the articles stay retryable ("error") and the run carries on
        for (const a of arts) if (loaded.some((l) => l.url === a.canonical_url)) await db.from("articles").update({ status: "error", error: `gemini: ${msg(e)}` }).eq("id", a.id);
        addError(`gemini ${arts[0]!.title?.slice(0, 50)}: ${msg(e)}`);
        return finish();
      }
      c.downgraded_quotes += x.downgraded.length;
      const ids = arts.map((a) => a.id);
      const markProcessed = async (startupId: number | null, note: string | null) => {
        await db.from("articles").update({ status: "processed", startup_id: startupId, error: note }).in("id", ids);
        finish();
      };

      if (!x.isAnnouncement) {
        c.not_announcements++;
        return markProcessed(null, "not a single-startup announcement");
      }
      const source = loaded.map((l) => `${l.title}\n${l.text}`).join("\n");
      const site = verifyWebsite(x.website, source, loaded.flatMap((l) => l.links), publisherDomains);
      const cand = { name_key: nameKey(x.name), domain: site?.domain ?? null };
      const known = await findStartup(db, cand);
      if (known) {
        c.duplicates++;
        return markProcessed(known.id, `duplicate of startup ${known.id}`);
      }
      // "announced in the last 24 hours" is judged on the EARLIEST report: later coverage of an old raise must not pass as new
      const publishedAt = arts.map((a) => (a.published_at ? new Date(a.published_at) : null)).filter(Boolean).sort((p, q) => p!.getTime() - q!.getTime())[0] ?? null;
      const d = decide({ rubric, now, publishedAt, stageLabel: x.stageLabel, stageQuote: x.stageQuote, amountUsd: x.amountUsd, marks: x.marks });
      const { startup, created } = await claimStartup(db, {
        ...cand,
        name: x.name,
        website: site?.url ?? null,
        sector: x.sector,
        location: x.location,
        stage_label: x.stageLabel,
        amount_text: x.amountText,
        amount_usd: x.amountUsd,
        investors: x.investors,
        founders: x.founders,
        description: x.description,
        status: d.pass ? "queued_overrule" : "rejected",
        reject_reason: d.reason,
        reject_quote: d.quote,
        score: d.hardRule ? null : d.score,
        marks: { criteria: x.marks, stage: { label: x.stageLabel, quote: x.stageQuote }, downgraded: x.downgraded, published_at: iso(publishedAt), score_if_scored: d.score },
        rubric_version: rubric.version,
        decided_at: iso(now),
      });
      if (!created) c.duplicates++;
      else {
        c.startups_new++;
        if (d.pass) c.passed++;
        else c.rejected++;
      }
      await markProcessed(startup.id, null);
      await flush();
    };

    await pool([...groups.values()], READ_CONCURRENCY, processGroup, late);
    const left = queue.filter((id) => !done.has(id));
    c.gemini_calls = budget.used;
    const n = nextAfterRead({ queueLeft: left.length, processedThisStage: done.size, stalls: c.stalls ?? 0, budgetLeft: budget.left });
    c.stalls = n.stalls;
    c.queue = n.dropQueue ? [] : left;
    if (n.dropQueue && left.length) {
      c.cap_hit = true;
      addError(`${left.length} articles not read (${budget.left <= 0 ? "Gemini call budget used up" : "no progress"}); they stay unread for the next run`);
    }
    if (n.next === "read") {
      await step("read", `${c.read} of ${c.candidates} articles read so far; continuing in a new function`, "active");
      return "read";
    }
    await step("read", `${c.read} of ${c.candidates} articles read, ${budget.used} Gemini calls`);
    await step("decide", `${c.passed} pass · ${c.rejected} rejected (saved with reasons) · ${c.duplicates} duplicates skipped`);
    return "draft";
  }

  // =====================================================================================================================
  // draft stage: passing startups (new, overruled, or retried)
  await step("email", "looking up emails", "active");
  const acct = await hunterAccount().catch(() => null);
  let hunterLeft = acct ? Math.max(0, acct.available - acct.used) : 0;
  let hunterCap = Math.max(0, rubric.hunterLookupsPerRun - (c.hunter_lookups ?? 0));
  const takeHunter = () => {
    if (hunterCap > 0 && hunterLeft > 0) {
      hunterCap--;
      hunterLeft--;
      c.hunter_lookups++;
      return true;
    }
    return false;
  };

  const saveGmail = async (draftRow: Row, startupId: number): Promise<void> => {
    try {
      const id = await createGmailDraft({ to: draftRow.email_source === "verified" ? draftRow.to_email : null, subject: draftRow.subject, body: draftRow.body });
      await db.from("drafts").update({ gmail_draft_id: id, status: draftRow.status === "pending_gmail" ? "new" : draftRow.status, updated_at: new Date().toISOString() }).eq("id", draftRow.id);
      await db.from("startups").update({ status: "drafted" }).eq("id", startupId);
      c.gmail_drafts++;
    } catch (e) {
      await db.from("drafts").update({ status: "pending_gmail", updated_at: new Date().toISOString() }).eq("id", draftRow.id);
      await db.from("startups").update({ status: "pending_gmail" }).eq("id", startupId);
      addError(`gmail: ${msg(e)}`);
    }
  };

  // Gmail retries first: content exists, only the Gmail draft is missing
  {
    const { data } = await db.from("drafts").select("*").eq("status", "pending_gmail").is("gmail_draft_id", null).not("subject", "is", null);
    for (const d of data ?? []) await saveGmail(d, d.startup_id);
  }

  const doneIds = new Set<number>(c.draft_done ?? []);
  const { data: queuedAll } = await db.from("startups").select("*").eq("status", "queued_overrule").order("score", { ascending: false, nullsFirst: false });
  const queued = ((queuedAll ?? []) as StartupRow[]).filter((s) => !doneIds.has(s.id));
  const draftOne = async (s: StartupRow) => {
    doneIds.add(s.id);
    c.draft_done = [...doneIds];
    const { draft } = await claimDraft(db, s.id);
    if (draft.subject && draft.body) {
      if (!draft.gmail_draft_id) await saveGmail(draft, s.id);
      else await db.from("startups").update({ status: "drafted" }).eq("id", s.id);
      return;
    }
    try {
      const { data: arts } = await db.from("articles").select("*").eq("startup_id", s.id).order("published_at", { ascending: false, nullsFirst: false }).limit(2);
      let articleTextAll = "";
      for (const a of arts ?? []) {
        const cached = textCache.get(a.canonical_url) ?? (await loadArticle(a).catch(() => null));
        if (cached) articleTextAll += `${a.title}\n${cached.text}\n\n`;
      }
      if (!articleTextAll) articleTextAll = s.description ?? "";

      let contacts: Contact[] = [];
      let homepage = "";
      // domain from the article (s.domain) or, failing that, a homepage-checked guess from the startup name
      let siteDomain: string | null = s.domain ?? domainOf(s.website);
      if (!siteDomain) {
        siteDomain = await guessWebsite(s.name);
        if (!siteDomain && process.env.GEMINI_SEARCH_ENABLED === "true" && budget.take()) {
          siteDomain = await findWebsiteViaSearch(s.name, [s.sector, s.location, s.description].filter(Boolean).join(", ").slice(0, 160), geminiSearch).catch(() => null);
        }
        if (siteDomain) await db.from("startups").update({ website: `https://${siteDomain}` }).eq("id", s.id);
      }
      if (siteDomain) {
        if (takeHunter()) {
          try {
            // an article-evidenced domain is trusted; a name-guessed one needs Hunter's organization to match the startup
            contacts = await hunterContacts(siteDomain, s.domain ? undefined : s.name);
          } catch (e) {
            addError(`hunter ${s.domain}: ${msg(e)}`);
          }
        }
        const site = await readSite(siteDomain);
        homepage = site.homepageText;
        // verified Hunter addresses first, then addresses found on the startup's own website (unverified)
        const hv = contacts.filter((x) => x.verified);
        const rest = [...site.contacts];
        contacts = [...hv, ...rest.filter((x, i) => rest.findIndex((y) => y.email === x.email) === i)].slice(0, 6);
      }
      // the person the email is addressed to is decided first (verified wins), so the greeting matches the To field
      const chosen = contacts.find((x) => x.verified) ?? contacts[0] ?? null;
      const out = await writeDraft(
        { startup: { name: s.name, sector: s.sector, location: s.location, stage: s.stage_label, amountText: s.amount_text, investors: s.investors ?? [], founders: s.founders ?? [], description: s.description }, articleText: articleTextAll, homepageText: homepage, contacts: chosen ? [chosen] : [], outreach: rubric.outreach, thesis: { sectors: rubric.thesisSectors, geographies: rubric.thesisGeographies } },
        undefined,
        () => budget.take(),
      );
      const emailSource = !chosen ? "none" : chosen.verified ? "verified" : "unverified";
      c[`emails_${emailSource}`]++;
      const row = { ...draft, to_email: chosen?.email ?? null, email_source: emailSource, contacts, subject: out.subject, body: out.body, inferred_points: out.inferredPoints, status: "new", updated_at: new Date().toISOString() };
      await db.from("drafts").update({ to_email: row.to_email, email_source: emailSource, contacts, subject: out.subject, body: out.body, inferred_points: out.inferredPoints, status: "new", updated_at: row.updated_at }).eq("id", draft.id);
      c.drafted++;
      await saveGmail(row, s.id);
    } catch (e) {
      await db.from("drafts").update({ status: "draft_failed", body: `[draft failed] ${msg(e)}`, updated_at: new Date().toISOString() }).eq("id", draft.id);
      addError(`draft ${s.name}: ${msg(e)}`);
    }
    await flush();
  };
  await pool(queued, CONCURRENCY, draftOne, () => late() || budget.left <= 0);
  c.gemini_calls = budget.used;
  c.draft_done = [...doneIds];
  const remaining = queued.filter((s) => !doneIds.has(s.id)).length;
  if (remaining > 0 && budget.left > 0) {
    await step("draft", `${c.drafted} drafts written so far; ${remaining} more, continuing in a new function`, "active");
    return "draft";
  }
  if (remaining > 0 && budget.left <= 0) addError(`${remaining} drafts not written (Gemini call budget used up); they are retried next run`);
  await step("email", `Hunter ${c.hunter_lookups} · verified ${c.emails_verified} · contact page ${c.emails_unverified} · none ${c.emails_none}`);
  await step("draft", `${c.drafted} drafts written`);
  await step("save", `${c.gmail_drafts} Gmail drafts created, dashboard updated`);
  await finishRun(db, runId, c, steps, errors, "ok");
  return null;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Starts the next stage as a separate invocation of /api/run/stage (which answers at once and works in the background). */
export async function triggerStage(origin: string, runId: number, stage: Stage): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${origin}/api/run/stage`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ runId, stage }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(1500 * 2 ** attempt);
  }
  return false;
}

/** Runs a stage, then hands over to the next one. A failure anywhere ends the run as an error and frees the lock. */
export async function driveStage(db: SupabaseClient, runId: number, stage: Stage, origin: string): Promise<void> {
  try {
    const next = await runStage(db, runId, stage);
    if (next && !(await triggerStage(origin, runId, next))) await failRun(db, runId, `could not start the ${next} stage`);
    if (!next) await notifyNewDrafts(db, runId, origin); // Telegram reminder; never throws
  } catch (e) {
    await failRun(db, runId, `${stage} stage failed: ${msg(e)}`);
  }
}
