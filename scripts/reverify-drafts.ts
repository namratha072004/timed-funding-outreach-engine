// npm run reverify:drafts — re-checks every draft marked "verified" with Hunter's verifier. Only valid + score 100 stays verified;
// anything else becomes "unverified" and the Gmail draft's To is cleared. Drafts only; nothing is sent.
import { hunterVerify, isHunterVerified } from "../lib/contacts";
import { updateGmailDraft } from "../lib/gmail";
import { serverDb } from "../lib/supabase";

const db = serverDb();
const { data } = await db.from("drafts").select("*, startups(name)").eq("email_source", "verified");
for (const d of data ?? []) {
  const v = await hunterVerify(d.to_email).catch(() => null);
  const ok = isHunterVerified(v);
  console.log(`${d.startups.name.padEnd(22)} verifier: ${v?.status ?? "n/a"} score ${v?.score ?? "n/a"} -> ${ok ? "stays verified" : "downgraded to unverified"}`);
  if (!ok) {
    await db.from("drafts").update({ email_source: "unverified", contacts: (d.contacts ?? []).map((c: any) => (c.email === d.to_email ? { ...c, verified: false } : c)), updated_at: new Date().toISOString() }).eq("id", d.id);
    if (d.gmail_draft_id) await updateGmailDraft(d.gmail_draft_id, { to: null, subject: d.subject, body: d.body }).catch((e) => console.log("  gmail update failed:", e.message));
  }
}
