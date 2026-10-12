import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { serverDb } from "@/lib/supabase";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!["new", "approved", "done"].includes(status ?? "")) return NextResponse.json({ error: "status must be new (To review), approved or done" }, { status: 400 });
  // never overwrite a draft that has no content or is waiting for Gmail
  const { data, error } = await serverDb().from("drafts").update({ status, updated_at: new Date().toISOString() }).eq("id", Number(id)).in("status", ["new", "approved", "done", "sent", "skipped"]).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "draft not found or not in a reviewable state" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
