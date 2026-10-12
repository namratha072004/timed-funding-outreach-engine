// npm run test:calibration — fetch 8 real articles, read-and-score each TWICE at temperature 0 on the SAME model, compare.
// Recency is not part of what is being calibrated, so publishedAt = now. Article text is cached locally (gitignored).
// Resumable: finished articles are saved in cache/results.json, so a rerun only does what is left (free-tier quota is 20/day/model).
// For each article the first candidate model that answers is used for both runs; the model used is reported.
import fs from "node:fs";
import path from "node:path";
import { loadRubric } from "../../lib/config";
import { decide } from "../../lib/decide";
import { readAndScore } from "../../lib/extract";
import { safeFetchText } from "../../lib/ssrf";
import { articleText } from "../../lib/text";
import { serverDb } from "../../lib/supabase";

delete process.env.GEMINI_FALLBACK_MODELS; // one model compared with itself, never a mid-run switch
process.env.GEMINI_RETRIES = "2";
process.env.GEMINI_TIMEOUT_MS = "150000";
const candidates = (process.env.CALIBRATION_MODELS ?? "gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.6-flash,gemini-flash-latest").split(",");

const dir = path.join(import.meta.dirname, "cache");
fs.mkdirSync(dir, { recursive: true });
const resultsFile = path.join(dir, "results.json");
const saved: Record<string, any> = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {};
const list = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "articles.json"), "utf8")) as { name: string; reference: string; url: string }[];
const rubric = await loadRubric(serverDb());
const now = new Date();
const keys = rubric.criteria.map((c) => c.key);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const a of list) {
  if (saved[a.name]?.runs) continue;
  const file = path.join(dir, a.name.replace(/\W+/g, "_") + ".txt");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text) {
    try {
      const r = await safeFetchText(a.url, { timeoutMs: 20_000 });
      if (r.status < 400) text = articleText(r.text).slice(0, 14_000);
    } catch { /* reported below */ }
    if (text.length > 300) fs.writeFileSync(file, text);
  }
  if (text.length < 300) {
    console.log(`== ${a.name}: NOT FOUND / unreadable, skipped (no text fabricated)`);
    saved[a.name] = { notFound: true };
    continue;
  }
  let done = false;
  for (let pass = 0; pass < 2 && !done; pass++) {
    for (const model of candidates) {
      process.env.GEMINI_MODEL = model;
      try {
        const runs = [];
        for (let i = 0; i < 2; i++) {
          const x = await readAndScore(rubric, [{ url: a.url, title: a.name, source: "calibration", text }], []);
          runs.push({ x, d: decide({ rubric, now, publishedAt: now, stageLabel: x.stageLabel, stageQuote: x.stageQuote, amountUsd: x.amountUsd, marks: x.marks }) });
        }
        saved[a.name] = { model, runs };
        fs.writeFileSync(resultsFile, JSON.stringify(saved));
        console.log(`   ${a.name}: both runs done on ${model}`);
        done = true;
        break;
      } catch (e) {
        console.log(`   ${a.name}: ${model} unavailable (${(e as Error).message.slice(0, 90)})`);
      }
    }
    if (!done && pass === 0) { console.log("   all candidates busy; waiting 45s"); await sleep(45_000); }
  }
  if (!done) saved[a.name] = { unavailable: true };
}

let agreeDecisions = 0, sameMarks = 0, totalMarks = 0, scored = 0;
for (const a of list) {
  const s = saved[a.name];
  if (!s?.runs) { console.log(`\n== ${a.name}: ${s?.notFound ? "NOT FOUND" : "NOT RUN (Gemini unavailable or out of quota)"}`); continue; }
  const [r1, r2] = s.runs;
  scored++;
  const same = keys.filter((k) => r1.x.marks[k]?.mark === r2.x.marks[k]?.mark).length;
  const agree = r1.d.pass === r2.d.pass;
  agreeDecisions += agree ? 1 : 0; sameMarks += same; totalMarks += keys.length;
  console.log(`\n== ${a.name}  [${s.model}]  reference: ${a.reference}  | announcement=${r1.x.isAnnouncement} stage=${r1.x.stageLabel}/${r2.x.stageLabel}`);
  for (const k of keys) {
    const m1 = r1.x.marks[k], m2 = r2.x.marks[k];
    console.log(`   ${k.padEnd(17)} run1=${m1.mark.padEnd(8)} run2=${m2.mark.padEnd(8)} ${m1.mark === m2.mark ? "    " : "DIFF"} "${(m1.quote ?? "").slice(0, 64)}"`);
  }
  console.log(`   score ${r1.d.score}/${r2.d.score} | decision ${r1.d.pass ? "PASS" : "REJECT"}/${r2.d.pass ? "PASS" : "REJECT"} | agree=${agree} | reason: ${r1.d.reason ?? "-"}`);
  if (r1.x.downgraded.length || r2.x.downgraded.length) console.log(`   quotes not found in text (downgraded): run1=[${r1.x.downgraded}] run2=[${r2.x.downgraded}]`);
}
const pct = totalMarks ? (100 * sameMarks) / totalMarks : 0;
console.log(`\nSUMMARY: articles scored ${scored}/${list.length}; identical decisions ${agreeDecisions}/${scored}; identical marks ${sameMarks}/${totalMarks} (${pct.toFixed(1)}%)`);
console.log(`ACCEPTANCE: decisions identical for all scored = ${agreeDecisions === scored}; marks identical >= 90% = ${pct >= 90}; all 8 scored = ${scored === list.length}`);
process.exit(agreeDecisions === scored && pct >= 90 && scored === list.length ? 0 : 1);
