// npm run enrich:drafts — fills in emails for existing drafts that have none (drafts only; nothing is sent).
// Domain: article-evidenced, else a name-based guess checked against the homepage. Hunter (verified) first, else contact page.
import { guessWebsite, hunterAccount, hunterVerified, readSite, type Contact } from "../lib/contacts";
import { updateGmailDraft } from "../lib/gmail";
import { serverDb } from "../lib/supabase";
import { domainOf } from "../lib/text";

const db = serverDb();
const acct = await hunterAccount();
let left = acct ? acct.available - acct.used : 0;
console.log(`Hunter searches left: ${left}`);
const { data: drafts } = await db.from("drafts").select("*, startups(*)").eq("email_source", "none").in("status", ["new", "pending_gmail"]);
for (const d of drafts ?? []) {
  const s = d.startups;
  if (!s || !d.subject) continue;
  let domain: string | null = s.domain ?? domainOf(s.website);
  if (!domain) {
    domain = await guessWebsite(s.name);
    if (domain) await db.from("startups").update({ website: `https://${domain}` }).eq("id", s.id);
  }
  if (!domain) { console.log(`${s.name}: no website found`); continue; }
  let contacts: Contact[] = [];
  if (left > 0) {
    left--;
    try { contacts = await hunterVerified(domain, s.domain ? undefined : s.name); } catch (e) { console.log(`${s.name}: hunter error ${(e as Error).message}`); }
  }
  if (!contacts.length) contacts = (await readSite(domain)).contacts;
  const chosen = contacts.find((c) => c.verified) ?? contacts[0] ?? null;
  const source = !chosen ? "none" : chosen.verified ? "verified" : "unverified";
  await db.from("drafts").update({ to_email: chosen?.email ?? null, email_source: source, contacts, updated_at: new Date().toISOString() }).eq("id", d.id);
  if (source === "verified" && d.gmail_draft_id) await updateGmailDraft(d.gmail_draft_id, { to: chosen!.email, subject: d.subject, body: d.body }).catch((e) => console.log(`${s.name}: gmail update failed ${e.message}`));
  console.log(`${s.name.padEnd(24)} ${domain.padEnd(26)} -> ${source}${source === "verified" ? " (Gmail To filled)" : ""}`);
}
