// npm run test:recreate — needs a running server (BASE_URL, default http://localhost:3100) and real Gmail.
// Makes a throwaway startup + draft row, then checks "Restore in Gmail": it creates the draft when Gmail has none, creates
// NOTHING when it is already there, and creates it again after it is deleted in Gmail. Cleans up Gmail and the database. Sends nothing.
import { deleteGmailDraft, resolveGmailDraft } from "../lib/gmail";
import { serverDb } from "../lib/supabase";

const base = process.env.BASE_URL || "http://localhost:3100";
let bad = 0;
const t = (name: string, ok: boolean, ev: string) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${ev}`); };
const db = serverDb();

const unlock = await fetch(`${base}/api/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: process.env.ACCESS_CODE || "x" }) });
const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0]!;
const restore = async (id: number) => (await fetch(`${base}/api/drafts/${id}/recreate`, { method: "POST", headers: { cookie } })).json() as Promise<any>;

const { data: s } = await db.from("startups").insert({ name: "[test] restore", name_key: `zz-test-restore-${Date.now()}`, status: "rejected" }).select("id").single();
const { data: d } = await db.from("drafts").insert({ startup_id: s!.id, subject: "[restore test] safe to delete", body: "Throwaway draft from npm run test:recreate.", email_source: "none", status: "done" }).select("id").single();
let gmailId: string | null = null;
try {
  const a = await restore(d!.id);
  t("restoring a draft Gmail does not have creates it", a.ok && a.created === true && /authuser=/.test(a.url ?? ""), `created=${a.created}`);
  gmailId = (await db.from("drafts").select("gmail_draft_id").eq("id", d!.id).single()).data!.gmail_draft_id;
  t("the new Gmail draft really exists", (await resolveGmailDraft(gmailId)).state === "ok", "found in Gmail");
  const b = await restore(d!.id);
  t("restoring again while it exists creates nothing (no duplicates)", b.ok && b.created === false, `created=${b.created}`);
  await deleteGmailDraft(gmailId!);
  t("after deleting it in Gmail it is reported missing", (await resolveGmailDraft(gmailId)).state === "missing", "missing");
  const c = await restore(d!.id);
  gmailId = (await db.from("drafts").select("gmail_draft_id").eq("id", d!.id).single()).data!.gmail_draft_id;
  t("restoring after the deletion puts it back", c.ok && c.created === true && (await resolveGmailDraft(gmailId)).state === "ok", `created=${c.created}`);
} finally {
  if (gmailId) await deleteGmailDraft(gmailId).catch(() => {});
  await db.from("startups").delete().eq("id", s!.id); // the draft row goes with it
}
console.log(bad ? `\n${bad} FAILED` : "\nall restore checks passed");
process.exit(bad ? 1 : 0);
