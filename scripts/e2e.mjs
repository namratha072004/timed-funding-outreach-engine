// npm run test:e2e — live end-to-end test against a running server (BASE_URL, default http://localhost:3100).
//  run 1: lookback_hours = 168      (real feeds, real Gemini, real Gmail drafts, never sent)
//  run 2: lookback_hours restored to 24, immediately after run 1 -> must create ZERO new drafts for known startups
//  run 3: lookback_hours = 168 again -> widening the window must not re-draft anything already drafted
// lookback_hours is always restored to its original value. Prints counts only, never secrets.
import { Agent, fetch as ufetch } from "undici";
const agent = new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 });
const base = process.env.BASE_URL || "http://localhost:3100";
const sb = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
const rest = async (p, init = {}) => { const r = await fetch(`${sb}/rest/v1/${p}`, { headers: { ...H, Prefer: "return=representation" }, ...init }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
const setLookback = (v) => rest("rubric_settings?key=eq.lookback_hours", { method: "PATCH", body: JSON.stringify({ value: v }) });
const snapshot = async () => {
  const [drafts, startups, articles] = await Promise.all([rest("drafts?select=id,startup_id,status,email_source,to_email,gmail_draft_id,created_at"), rest("startups?select=id,name,status,domain"), rest("articles?select=status")]);
  const by = (a, f) => a.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  return { drafts, startups, counts: { articles: by(articles, (x) => x.status), startups: by(startups, (x) => x.status), drafts: by(drafts, (x) => x.status), emails: by(drafts, (x) => x.email_source), gmail_ids: drafts.filter((d) => d.gmail_draft_id).length } };
};
const run = async (label) => {
  const t = Date.now();
  const r = await ufetch(`${base}/api/run`, { dispatcher: agent, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(600_000) });
  const j = await r.json();
  console.log(`\n--- ${label}: HTTP ${r.status}, ${Math.round((Date.now() - t) / 1000)}s`);
  const { steps, ...c } = j.counts ?? {};
  console.log(JSON.stringify({ status: j.status, ...c, error_count: j.errors }));
  if (j.errors) { const [row] = await rest(`runs?id=eq.${j.runId}&select=errors`); console.log("errors:", JSON.stringify(row.errors).slice(0, 1500)); }
  return j;
};

const [orig] = await rest("rubric_settings?key=eq.lookback_hours&select=value");
console.log("original lookback_hours =", orig.value);
let failed = false;
try {
  await setLookback(168);
  const before = await snapshot();
  console.log("before:", JSON.stringify(before.counts));
  await run("RUN 1 (lookback 168)");
  const s1 = await snapshot();
  console.log("after run 1:", JSON.stringify(s1.counts));

  await setLookback(orig.value);
  console.log("lookback_hours restored to", orig.value);
  await run("RUN 2 (lookback restored, immediately after)");
  const s2 = await snapshot();
  console.log("after run 2:", JSON.stringify(s2.counts));
  const newDrafts2 = s2.drafts.filter((d) => !s1.drafts.some((x) => x.id === d.id));
  const ok2 = newDrafts2.length === 0 && s2.counts.gmail_ids === s1.counts.gmail_ids;
  console.log(`${ok2 ? "PASS" : "FAIL"}  run 2 created ${newDrafts2.length} new draft rows, gmail drafts ${s1.counts.gmail_ids} -> ${s2.counts.gmail_ids}`);

  await setLookback(168);
  await run("RUN 3 (window widened again)");
  const s3 = await snapshot();
  const regenerated = s3.drafts.filter((d) => { const o = s1.drafts.find((x) => x.id === d.id); return o && (o.gmail_draft_id !== d.gmail_draft_id || o.created_at !== d.created_at); });
  const dupStartups = Object.values(s3.drafts.reduce((m, d) => ((m[d.startup_id] = (m[d.startup_id] ?? 0) + 1), m), {})).filter((n) => n > 1).length;
  const dupDomains = s3.startups.filter((s) => s.domain).map((s) => s.domain).length - new Set(s3.startups.filter((s) => s.domain).map((s) => s.domain)).size;
  const ok3 = regenerated.length === 0 && dupStartups === 0 && dupDomains === 0;
  console.log(`${ok3 ? "PASS" : "FAIL"}  run 3 (widened): previously drafted startups re-drafted = ${regenerated.length}; startups with 2+ drafts = ${dupStartups}; duplicate domains = ${dupDomains}`);
  console.log("after run 3:", JSON.stringify(s3.counts));
  const rejectedOnReview = s3.drafts.filter((d) => s3.startups.find((s) => s.id === d.startup_id)?.status === "rejected").length;
  console.log(`${rejectedOnReview === 0 ? "PASS" : "FAIL"}  rejected startups with a draft row = ${rejectedOnReview}`);
  const badTo = s3.drafts.filter((d) => d.email_source !== "verified" && false).length;
  console.log("emails by source:", JSON.stringify(s3.counts.emails));
  failed = !(ok2 && ok3 && rejectedOnReview === 0);
} catch (e) {
  console.log("E2E ERROR:", e.message, e.cause?.code ?? e.cause?.message ?? "");
  failed = true;
} finally {
  await setLookback(orig.value);
  const [now] = await rest("rubric_settings?key=eq.lookback_hours&select=value");
  console.log("lookback_hours finally =", now.value);
}
process.exit(failed ? 1 : 0);
