import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { createGmailDraft, resolveGmailDraft } from "@/lib/gmail";
import { serverDb } from "@/lib/supabase";

/**
 * Puts the saved draft back into Gmail (for example after it was deleted there by accident). It never sends anything.
 * If Gmail still has the draft, nothing is created and the existing one is returned, so this cannot make duplicates.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const db = serverDb();
  const { data: d } = await db.from("drafts").select("*").eq("id", Number(id)).maybeSingle();
  if (!d) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  if (!d.subject || !d.body || d.status === "draft_failed") return NextResponse.json({ error: "This draft has no email text to put back. It is rewritten on the next run." }, { status: 409 });
  try {
    const now = await resolveGmailDraft(d.gmail_draft_id);
    if (now.state === "ok") return NextResponse.json({ ok: true, created: false, url: now.url });
    const stored = await createGmailDraft({ to: d.email_source === "verified" ? d.to_email : null, subject: d.subject, body: d.body });
    await db.from("drafts").update({ gmail_draft_id: stored, status: d.status === "pending_gmail" ? "new" : d.status, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (d.status === "pending_gmail") await db.from("startups").update({ status: "drafted" }).eq("id", d.startup_id);
    const fresh = await resolveGmailDraft(stored);
    return NextResponse.json({ ok: true, created: true, url: fresh.state === "ok" ? fresh.url : null });
  } catch {
    return NextResponse.json({ error: "Gmail did not accept the draft. Try again in a moment." }, { status: 502 });
  }
}
