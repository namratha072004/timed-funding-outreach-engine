// npm run apply:24h — moves drafted startups whose FIRST report was older than the look-back window when the draft was made into
// Rejected ("older than Nh"). Drafts and Gmail drafts are kept; Overrule on the Rejected page brings one back. Nothing is deleted or sent.
import { loadRubric } from "../lib/config";
import { serverDb } from "../lib/supabase";

const db = serverDb();
const r = await loadRubric(db);
if (r.lookbackHours == null) { console.log("no look-back window set"); process.exit(0); }
const { data: sts } = await db.from("startups").select("id,name,status").in("status", ["drafted", "pending_gmail"]);
for (const s of sts ?? []) {
  const { data: d } = await db.from("drafts").select("created_at").eq("startup_id", s.id).single();
  const { data: arts } = await db.from("articles").select("published_at").eq("startup_id", s.id).not("published_at", "is", null).order("published_at", { ascending: true }).limit(1);
  const first = arts?.[0]?.published_at;
  if (!d || !first) { console.log(`keep   ${s.name} (no date to judge)`); continue; }
  const hours = (new Date(d.created_at).getTime() - new Date(first).getTime()) / 3_600_000;
  if (hours <= r.lookbackHours) { console.log(`keep   ${s.name} (first report ${hours.toFixed(1)} h before the draft)`); continue; }
  await db.from("startups").update({ status: "rejected", reject_reason: `older than ${r.lookbackHours}h`, reject_quote: null, score: null, decided_at: new Date().toISOString(), rubric_version: r.version }).eq("id", s.id);
  console.log(`moved  ${s.name} (first report ${Math.round(hours)} h before the draft)`);
}
