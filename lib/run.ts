import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRubric } from "./config";
import { findWebsiteViaSearch, guessWebsite, hunterAccount, hunterVerified, readSite, verifyWebsite, type Contact } from "./contacts";
import { decide } from "./decide";
import { writeDraft } from "./draft";
import { readAndScore, type ArticleInput, type Extraction } from "./extract";
import { fetchFeed, type FeedItem, type FeedRow } from "./feeds";
import { filterItem, keywordMatcher } from "./filter";
import { Budget, geminiSearch, setGeminiDeadline } from "./gemini";
import { createGmailDraft } from "./gmail";
import { acquireLock, LEASE_SECONDS, releaseLock } from "./lock";
import { claimDraft, claimStartup, findStartup, pool, type StartupRow } from "./memory";
import { safeFetchText } from "./ssrf";
import { articleText, domainOf, externalLinks, guessNameFromTitle, nameKey, publishedFromHtml } from "./text";
import type { Rubric } from "./types";

/** Hobby plan: 300 s hard limit. Stop starting new work at 240 s. Concurrency 3. */
export const WALL_CLOCK_MS = 240_000;
export const CONCURRENCY = 3;
const HOUR = 3_600_000;

export const STEPS = [
  { key: "lock", label: "Lock taken" },
  { key: "fetch", label: "Fetching news" },
  { key: "filter", label: "Keyword filter (code)" },
  { key: "memory", label: "Memory check" },
  { key: "read", label: "Gemini reads + scores" },
  { key: "decide", label: "Code decides" },
  { key: "email", label: "Email lookup (passes only)" },
  { key: "draft", label: "Gemini writes drafts" },
  { key: "save", label: "Saved" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

type Row = Record<string, any>;
export interface RunResult {
  runId: number | null;
  status: "ok" | "skipped" | "error";
  counts: Record<string, any>;
  errors: string[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/(key|token|secret)=[^&\s]+/gi, "$1=***").slice(0, 300);

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

export async function executeRun(db: SupabaseClient, opts: { trigger: "cron" | "manual" }): Promise<RunResult> {
  const t0 = Date.now();
  const holder = `${opts.trigger}-${t0}-${Math.random().toString(36).slice(2, 8)}`;
  const deadline = t0 + WALL_CLOCK_MS;
  const late = () => Date.now() > deadline;
  setGeminiDeadline(deadline + 30_000); // a started call may finish, but nothing runs past 270 s of the 300 s limit

  const c: Record<string, any> = {
    trigger: opts.trigger, fetched: 0, new_articles: 0, filtered: 0, candidates: 0, read: 0, groups: 0,
    startups_new: 0, passed: 0, rejected: 0, drafted: 0, gmail_drafts: 0, duplicates: 0, not_announcements: 0,
    rescored: 0, errors: 0, gemini_calls: 0, hunter_lookups: 0, emails_verified: 0, emails_unverified: 0, emails_none: 0,
    downgraded_quotes: 0, deadline_hit: false, cap_hit: false,
  };
  const errors: string[] = [];
  const addError = (e: string) => {
    c.errors++;
    if (errors.length < 50) errors.push(e);
  };

  if (!(await acquireLock(db, holder))) {
    const { data } = await db.from("runs").insert({ status: "skipped", finished_at: new Date().toISOString(), counts: { reason: "skipped: already running", trigger: opts.trigger } }).select("id").single();
    return { runId: data?.id ?? null, status: "skipped", counts: { reason: "skipped: already running" }, errors: [] };
  }

  const steps = STEPS.map((s) => ({ ...s, state: "pending" as "pending" | "active" | "done", detail: "" }));
  const { data: runRow } = await db.from("runs").insert({ status: "ok", counts: { ...c, steps } }).select("id").single();
  const runId: number | null = runRow?.id ?? null;
  let lastWrite = 0;
  const flush = async (force = false) => {
    if (!runId || (!force && Date.now() - lastWrite < 2000)) return;
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
  await step("lock", `lease ${LEASE_SECONDS}s, holder ${holder.slice(0, 12)}`);

  let status: "ok" | "error" = "ok";
  let sourceDelays: Record<string, any> = {};
  try {
    const rubric = await loadRubric(db);
    const now = new Date();
    const budget = new Budget(rubric.maxGeminiCallsPerRun);
    const readReserve = Math.min(10, Math.ceil(rubric.maxGeminiCallsPerRun / 4)); // keep calls for drafts

    // ---- re-score rejected startups only if the rubric version changed (code only, no AI)
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

    // ---- fetch news
    await step("fetch", "reading feeds", "active");
    const { data: feedRows } = await db.from("feeds").select("*").eq("active", true).order("id");
    const feedItems = new Map<string, FeedItem>();
    await pool((feedRows ?? []) as FeedRow[], 4, async (f) => {
      try {
        for (const it of await fetchFeed(f)) if (!feedItems.has(it.url)) feedItems.set(it.url, it);
      } catch (e) {
        addError(`feed ${f.name}: ${msg(e)}`);
      }
    });
    c.fetched = feedItems.size;
    const newByUrl = new Map<string, string>(); // url -> source, for delay stats
    {
      const all = [...feedItems.values()];
      for (let i = 0; i < all.length; i += 200) {
        const chunk = all.slice(i, i + 200);
        const { data, error } = await db
          .from("articles")
          .upsert(chunk.map((it) => ({ canonical_url: it.url, title: it.title, source: it.source, published_at: iso(it.publishedAt) })), { onConflict: "canonical_url", ignoreDuplicates: true })
          .select("canonical_url, published_at, first_seen_at, source");
        if (error) throw new Error(`saving articles: ${error.message}`);
        c.new_articles += data?.length ?? 0;
        const acc: Record<string, number[]> = (sourceDelays as any)._acc ?? ((sourceDelays as any)._acc = {});
        for (const r of data ?? []) {
          newByUrl.set(r.canonical_url, r.source);
          if (r.published_at) {
            const h = (new Date(r.first_seen_at).getTime() - new Date(r.published_at).getTime()) / HOUR;
            if (h >= 0 && h < 24 * 14) (acc[r.source] ??= []).push(h);
          }
        }
      }
      const acc: Record<string, number[]> = (sourceDelays as any)._acc ?? {};
      sourceDelays = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { avg_hours: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), n: v.length }]));
    }
    await step("fetch", `${feedRows?.length ?? 0} feeds → ${c.fetched} items, ${c.new_articles} new`);

    // ---- keyword filter + memory check
    await step("filter", "applying keyword and age filter", "active");
    const match = keywordMatcher(rubric.fundingKeywords);
    const since = new Date(now.getTime() - 30 * 24 * HOUR).toISOString();
    const { data: pending } = await db
      .from("articles")
      .select("*")
      .or("status.in.(new,error),and(status.eq.filtered_out,error.like.older than%)")
      .gte("first_seen_at", since)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    const candidates: Row[] = [];
    const toFilter: { id: number; reason: string }[] = [];
    for (const a of pending ?? []) {
      const item = feedItems.get(a.canonical_url);
      const v = filterItem(
        { title: a.title ?? "", summary: item ? `${item.summary}\n${item.content.slice(0, 1500)}` : "", publishedAt: a.published_at ? new Date(a.published_at) : null },
        { match, lookbackHours: rubric.lookbackHours, now, checkKeywords: !!item || (a.status === "new" && newByUrl.has(a.canonical_url)) },
      );
      if (v.keep) {
        candidates.push(a);
        if (a.status === "filtered_out") await db.from("articles").update({ status: "new", error: null }).eq("id", a.id);
      } else if (a.status !== "filtered_out" || a.error !== v.reason) toFilter.push({ id: a.id, reason: v.reason });
    }
    for (const f of toFilter) await db.from("articles").update({ status: "filtered_out", error: f.reason }).eq("id", f.id);
    c.filtered = toFilter.length;
    await step("filter", `${c.fetched} items → ${candidates.length} look like funding news in the last ${rubric.lookbackHours}h`);

    const capped = candidates.slice(0, rubric.maxArticlesPerRun);
    c.candidates = candidates.length;
    c.cap_hit = candidates.length > capped.length;
    const groups = new Map<string, Row[]>();
    for (const a of capped) {
      const g = guessNameFromTitle(a.title ?? "");
      const key = g ? `n:${nameKey(g)}` : `u:${a.id}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    c.groups = groups.size;
    await step("memory", `${candidates.length} unseen candidates → ${groups.size} startups to read${c.cap_hit ? ` (cap ${rubric.maxArticlesPerRun}, rest next run)` : ""}`);

    // ---- Gemini read + score, code decides
    await step("read", "reading articles with Gemini", "active");
    const textCache = new Map<string, { text: string; links: string[] }>();
    const publisherDomains = [...new Set((feedRows ?? []).map((f: Row) => domainOf(f.url)).filter(Boolean) as string[])];

    const loadArticle = async (a: Row): Promise<ArticleInput & { links: string[] }> => {
      const item = feedItems.get(a.canonical_url);
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
      const feedText = item ? (item.content.length > item.summary.length ? item.content : item.summary) : "";
      if (text.length < 600 && feedText.length > text.length) text = feedText;
      if (text.length < 150) throw new Error("no readable article text");
      textCache.set(a.canonical_url, { text, links });
      return { url: a.canonical_url, title: a.title ?? "", source: a.source ?? "", text: text.slice(0, 14_000), links };
    };

    let decidedPass = 0;
    const processGroup = async (arts: Row[]) => {
      if (budget.left <= readReserve) {
        c.cap_hit = true;
        return;
      }
      const loaded: (ArticleInput & { links: string[] })[] = [];
      for (const a of arts) {
        try {
          loaded.push(await loadArticle(a));
        } catch (e) {
          await db.from("articles").update({ status: "error", error: msg(e) }).eq("id", a.id);
          addError(`article ${a.canonical_url}: ${msg(e)}`);
        }
      }
      if (!loaded.length) return;
      if (!budget.take()) return;
      c.read += loaded.length;
      let x: Extraction;
      try {
        x = await readAndScore(rubric, loaded, loaded.flatMap((l) => l.links));
      } catch (e) {
        // Gemini failure: leave the articles retryable ("not seen") and carry on
        for (const a of arts) if (loaded.some((l) => l.url === a.canonical_url)) await db.from("articles").update({ status: "error", error: `gemini: ${msg(e)}` }).eq("id", a.id);
        addError(`gemini ${arts[0]!.title?.slice(0, 50)}: ${msg(e)}`);
        return;
      }
      c.downgraded_quotes += x.downgraded.length;
      const ids = arts.map((a) => a.id);
      const markProcessed = async (startupId: number | null, note: string | null) =>
        db.from("articles").update({ status: "processed", startup_id: startupId, error: note }).in("id", ids);

      if (!x.isAnnouncement) {
        c.not_announcements++;
        await markProcessed(null, "not a single-startup announcement");
        return;
      }
      const source = loaded.map((l) => `${l.title}\n${l.text}`).join("\n");
      const site = verifyWebsite(x.website, source, loaded.flatMap((l) => l.links), publisherDomains);
      const cand = { name_key: nameKey(x.name), domain: site?.domain ?? null };
      const known = await findStartup(db, cand);
      if (known) {
        c.duplicates++;
        await markProcessed(known.id, `duplicate of startup ${known.id}`);
        return;
      }
      const publishedAt = arts.map((a) => (a.published_at ? new Date(a.published_at) : null)).filter(Boolean).sort((p, q) => q!.getTime() - p!.getTime())[0] ?? null;
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
        if (d.pass) {
          c.passed++;
          decidedPass++;
        } else c.rejected++;
      }
      await markProcessed(startup.id, null);
      await flush();
    };

    await pool([...groups.values()], CONCURRENCY, processGroup, () => {
      if (late()) c.deadline_hit = true;
      return late();
    });
    await step("read", `${c.read} articles read in ${c.groups} groups, ${budget.used} Gemini calls`);
    await step("decide", `${c.passed} pass · ${c.rejected} rejected (saved with reasons) · ${c.duplicates} duplicates skipped`);

    // ---- drafts for passing startups (new, overruled, or retried)
    await step("email", "looking up emails", "active");
    const acct = await hunterAccount().catch(() => null);
    let hunterLeft = acct ? Math.max(0, acct.available - acct.used) : 0;
    let hunterCap = rubric.hunterLookupsPerRun;
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

    const { data: queued } = await db.from("startups").select("*").eq("status", "queued_overrule").order("score", { ascending: false, nullsFirst: false });
    const draftOne = async (s: StartupRow) => {
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
              contacts = await hunterVerified(siteDomain, s.domain ? undefined : s.name);
            } catch (e) {
              addError(`hunter ${s.domain}: ${msg(e)}`);
            }
          }
          const site = await readSite(siteDomain);
          homepage = site.homepageText;
          if (!contacts.length) contacts = site.contacts;
        }
        const out = await writeDraft(
          { startup: { name: s.name, sector: s.sector, location: s.location, stage: s.stage_label, amountText: s.amount_text, investors: s.investors ?? [], founders: s.founders ?? [], description: s.description }, articleText: articleTextAll, homepageText: homepage, contacts, outreach: rubric.outreach },
          undefined,
          () => budget.take(),
        );
        // Gemini picks from the list; if it returned null but contacts exist, code takes the best one (verified first)
        const chosen = contacts.find((x) => x.email === out.chosenContact) ?? contacts.find((x) => x.verified) ?? contacts[0] ?? null;
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
    };
    await pool((queued ?? []) as StartupRow[], CONCURRENCY, draftOne, () => {
      if (late()) c.deadline_hit = true;
      return late() || budget.left <= 0;
    });
    c.gemini_calls = budget.used;
    await step("email", `Hunter ${c.hunter_lookups} · verified ${c.emails_verified} · contact page ${c.emails_unverified} · none ${c.emails_none}`);
    await step("draft", `${c.drafted} drafts written`);
    await step("save", `${c.gmail_drafts} Gmail drafts created, dashboard updated`);
  } catch (e) {
    status = "error";
    addError(`run: ${msg(e)}`);
  } finally {
    c.duration_ms = Date.now() - t0;
    steps.forEach((s) => status === "ok" && (s.state = "done"));
    await db.from("runs").update({ finished_at: new Date().toISOString(), status, counts: { ...c, steps }, errors, source_delays: sourceDelays }).eq("id", runId!);
    await releaseLock(db, holder);
  }
  return { runId, status, counts: c, errors };
}
