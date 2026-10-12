// npm run rewrite:drafts — writes every existing draft again with the current rules (no [placeholders], natural shape, greeting
// matches the recipient) and updates its Gmail draft. Recipients do not change. Nothing is ever sent.
import { loadRubric } from "../lib/config";
import { readSite } from "../lib/contacts";
import { writeDraft } from "../lib/draft";
import { createGmailDraft, resolveGmailDraft, updateGmailDraft } from "../lib/gmail";
import { safeFetchText } from "../lib/ssrf";
import { serverDb } from "../lib/supabase";
import { articleText, domainOf } from "../lib/text";

const db = serverDb();
const rubric = await loadRubric(db);
const { data: drafts } = await db.from("drafts").select("*, startups(*)").not("subject", "is", null).neq("status", "draft_failed");
let ok = 0;
for (const d of drafts ?? []) {
  const s = d.startups;
  if (!s) continue;
  try {
    const { data: arts } = await db.from("articles").select("title,canonical_url,published_at").eq("startup_id", s.id).order("published_at", { ascending: true, nullsFirst: false }).limit(2);
    let text = "";
    for (const a of arts ?? []) {
      const r = await safeFetchText(a.canonical_url, { maxBytes: 1_500_000, timeoutMs: 10_000 }).catch(() => null);
      if (r && r.status < 400) text += `${a.title}\n${articleText(r.text)}\n\n`;
    }
    if (!text) text = s.description ?? "";
    const domain = s.domain ?? domainOf(s.website);
    const homepage = domain ? (await readSite(domain).catch(() => null))?.homepageText ?? "" : "";
    const contact = (d.contacts ?? []).find((c: any) => c.email === d.to_email) ?? null;
    const out = await writeDraft({
      startup: { name: s.name, sector: s.sector, location: s.location, stage: s.stage_label, amountText: s.amount_text, investors: s.investors ?? [], founders: s.founders ?? [], description: s.description },
      articleText: text, homepageText: homepage, contacts: contact ? [contact] : [], outreach: rubric.outreach,
      thesis: { sectors: rubric.thesisSectors, geographies: rubric.thesisGeographies },
    });
    await db.from("drafts").update({ subject: out.subject, body: out.body, inferred_points: out.inferredPoints, updated_at: new Date().toISOString() }).eq("id", d.id);
    const to = d.email_source === "verified" ? d.to_email : null;
    let stored: string | null = d.gmail_draft_id;
    try {
      if (!stored) throw new Error("none");
      await updateGmailDraft(stored, { to, subject: out.subject, body: out.body });
    } catch {
      stored = await createGmailDraft({ to, subject: out.subject, body: out.body });
    }
    const now = await resolveGmailDraft(stored);
    if (now.state === "ok") stored = now.stored;
    await db.from("drafts").update({ gmail_draft_id: stored }).eq("id", d.id);
    ok++;
    console.log(`OK   ${s.name.padEnd(22)} ${out.body.split(/\s+/).length} words`);
  } catch (e) {
    console.log(`FAIL ${s.name}: ${(e as Error).message.slice(0, 120)}`);
  }
}
console.log(`${ok} of ${drafts?.length ?? 0} rewritten`);
