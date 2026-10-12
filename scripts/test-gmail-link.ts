// npm run test:gmail-link — against real Gmail: makes a throwaway draft, checks the app finds it and builds the right link,
// edits it (which changes its message id) and checks the link follows, deletes it and checks the app reports it as missing.
// Never sends anything and removes its own draft.
import { createGmailDraft, deleteGmailDraft, resolveGmailDraft, updateGmailDraft } from "../lib/gmail";

let bad = 0;
const t = (name: string, ok: boolean, ev: string) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${ev}`); };

const stored = await createGmailDraft({ to: null, subject: "[link test] safe to delete", body: "Test draft made by npm run test:gmail-link. It is deleted straight away." });
try {
  const a = await resolveGmailDraft(stored);
  t("a new draft is found", a.state === "ok", a.state);
  t("the link names the Gmail account and the message", a.state === "ok" && /^https:\/\/mail\.google\.com\/mail\/\?authuser=[^#]+#drafts\?compose=[0-9a-f]+$/.test(a.url), a.state === "ok" ? a.url.replace(/authuser=[^#]+/, "authuser=<account>") : "-");
  await updateGmailDraft(stored, { to: null, subject: "[link test] edited", body: "edited" });
  const b = await resolveGmailDraft(stored);
  t("after an edit the saved message id is stale, and the lookup returns the new one", a.state === "ok" && b.state === "ok" && a.stored !== b.stored, a.state === "ok" && b.state === "ok" ? `${a.stored.split(":")[1]} -> ${b.stored.split(":")[1]}` : "-");
} finally {
  await deleteGmailDraft(stored);
}
const c = await resolveGmailDraft(stored);
t("a deleted draft is reported as missing", c.state === "missing", c.state);
console.log(bad ? `\n${bad} FAILED` : "\nall Gmail link checks passed");
process.exit(bad ? 1 : 0);
