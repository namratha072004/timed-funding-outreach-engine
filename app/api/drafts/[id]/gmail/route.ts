import { NextResponse } from "next/server";
import { resolveGmailDraft } from "@/lib/gmail";
import { serverDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// A page view must not turn into a stream of Gmail calls: at most 30 lookups a minute per server instance.
const hits: number[] = [];
const limited = () => {
  const now = Date.now();
  while (hits.length && now - hits[0]! > 60_000) hits.shift();
  if (hits.length >= 30) return true;
  hits.push(now);
  return false;
};

/**
 * Where is this draft in Gmail right now? Read-only, so it needs no code; it returns a link, never draft text.
 * Also refreshes the saved Gmail id, which changes when a draft is edited.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (limited()) return NextResponse.json({ error: "Too many clicks in a minute. Try again shortly." }, { status: 429 });
  const db = serverDb();
  const { data: d } = await db.from("drafts").select("id,gmail_draft_id").eq("id", Number(id)).maybeSingle();
  if (!d) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  try {
    const r = await resolveGmailDraft(d.gmail_draft_id);
    if (r.state === "ok" && r.stored !== d.gmail_draft_id) await db.from("drafts").update({ gmail_draft_id: r.stored }).eq("id", d.id);
    return NextResponse.json(r);
  } catch {
    return NextResponse.json({ error: "Could not reach Gmail. Try again in a moment." }, { status: 502 });
  }
}
