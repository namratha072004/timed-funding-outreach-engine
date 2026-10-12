// Loads the live rubric from Supabase and prints it (no secrets).
import { loadRubric } from "../lib/config";
import { serverDb } from "../lib/supabase";

const r = await loadRubric(serverDb());
console.log(JSON.stringify({ ...r, criteria: r.criteria.map((c) => `${c.key}:${c.weight}${c.rejectOnNo ? ":reject_on_no" : ""}${c.allowsPartial ? ":partial" : ""}`), outreach: Object.keys(r.outreach), fundingKeywords: r.fundingKeywords.length }, null, 1));
console.log("active weight total =", r.criteria.reduce((a, c) => a + c.weight, 0));
