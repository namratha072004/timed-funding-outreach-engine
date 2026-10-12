// npm run test:settings — saves today's live values back through the real save code and checks that nothing changes:
// no row is written and the rubric version does not move. Then checks that the saved shapes pass validation.
import { loadRubric } from "../lib/config";
import { REJECT_ON_NO_KEYS, validateRubric, validateRun } from "../lib/settings";
import { currentVersion, saveRubric, saveRunSettings } from "../lib/settings-db";
import { serverDb } from "../lib/supabase";

const db = serverDb();
let bad = 0;
const t = (name: string, ok: boolean, ev: string) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${ev}`); };

const r = await loadRubric(db);
const v0 = await currentVersion(db);
const rubric = validateRubric(
  {
    passMark: r.passMark,
    weights: Object.fromEntries(r.criteria.map((c) => [c.key, c.weight])),
    rejectOnNo: Object.fromEntries(r.criteria.filter((c) => (REJECT_ON_NO_KEYS as readonly string[]).includes(c.key)).map((c) => [c.key, c.rejectOnNo])),
    sectors: r.thesisSectors,
    geographies: r.thesisGeographies,
    stages: r.allowedStages,
    lookbackHours: r.lookbackHours ?? 24,
  },
  r.criteria.map((c) => c.key),
);
t("the live rubric passes validation", true, `pass mark ${rubric.passMark}, ${Object.keys(rubric.weights).length} weights`);
const run = validateRun({ maxArticles: r.maxArticlesPerRun, maxGemini: r.maxGeminiCallsPerRun, hunterLookups: r.hunterLookupsPerRun, keywords: r.fundingKeywords });
t("the live run settings pass validation", true, `${run.keywords.length} funding words`);

const a = await saveRubric(db, rubric);
const b = await saveRunSettings(db, run);
const v1 = await currentVersion(db);
t("saving the rubric unchanged writes nothing", a.changed === false, `changed=${a.changed}`);
t("saving run settings unchanged writes nothing", b.changed === false, `changed=${b.changed}`);
t("the rubric version did not move", v0 === v1 && a.version === v0, `v${v0} -> v${v1}`);
console.log(bad ? `\n${bad} FAILED` : "\nall settings checks passed");
process.exit(bad ? 1 : 0);
