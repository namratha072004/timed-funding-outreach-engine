import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { serverDb } from "@/lib/supabase";

/** Queue a rejected startup for drafting on the next run. It still goes through email lookup and the draft rules. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await serverDb().from("startups").update({ status: "queued_overrule" }).eq("id", Number(id)).eq("status", "rejected").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "startup not found or not rejected" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
