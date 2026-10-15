// npm run fix:greetings — makes the "Hi <name>," line of every existing draft match the person in the To field (see fixGreeting
// in lib/draft.ts), in the database and in the Gmail draft. Only that one line changes. Nothing is ever sent. DRY=1 lists without writing.
import { fixGreeting } from "../lib/draft";
import { createGmailDraft, resolveGmailDraft, updateGmailDraft } from "../lib/gmail";
import { serverDb } from "../lib/supabase";

const db = serverDb();
const { data: drafts } = await db.from("drafts").select("*, startups(name)").not("body", "is", null).neq("status", "draft_failed");
let changed = 0;
for (const d of drafts ?? []) {
  const contact = (d.contacts ?? []).find((c: any) => c.email === d.to_email) ?? null;
  const fixed = fixGreeting(d.body, contact);
  if (fixed === d.body) continue;
  console.log(`${process.env.DRY ? "would fix" : "fixing   "} ${String(d.startups?.name).padEnd(22)} ${d.body.split("\n")[0]}  ->  ${fixed.split("\n")[0]}   (to ${d.to_email})`);
  changed++;
  if (process.env.DRY) continue;
  await db.from("drafts").update({ body: fixed, updated_at: new Date().toISOString() }).eq("id", d.id);
  const to = d.email_source === "verified" ? d.to_email : null;
  let stored: string | null = d.gmail_draft_id;
  try {
    if (!stored) throw new Error("none");
    await updateGmailDraft(stored, { to, subject: d.subject, body: fixed });
  } catch {
    stored = await createGmailDraft({ to, subject: d.subject, body: fixed });
  }
  const now = await resolveGmailDraft(stored);
  if (now.state === "ok") stored = now.stored;
  await db.from("drafts").update({ gmail_draft_id: stored }).eq("id", d.id);
}
console.log(`${changed} of ${drafts?.length ?? 0} drafts needed a new greeting`);
