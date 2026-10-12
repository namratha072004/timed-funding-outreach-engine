import { NextResponse, after } from "next/server";
import { authorize } from "@/lib/auth";
import { driveStage, type Stage } from "@/lib/run";
import { serverDb } from "@/lib/supabase";

// One stage of a run, in its own function invocation. Internal: only the bearer token is accepted.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await authorize(req, { cookie: false, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { runId?: number; stage?: string };
  const stage = body.stage as Stage;
  if (!Number.isInteger(body.runId) || !["ingest", "read", "draft"].includes(stage)) return NextResponse.json({ error: "runId and stage (ingest, read or draft) are required" }, { status: 400 });
  const db = serverDb();
  const { data } = await db.from("runs").select("id,finished_at").eq("id", body.runId!).maybeSingle();
  if (!data) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (data.finished_at) return NextResponse.json({ status: "already finished" }, { status: 200 });
  const origin = new URL(req.url).origin;
  const runId = body.runId!;
  after(() => driveStage(db, runId, stage, origin));
  return NextResponse.json({ status: "stage started", runId, stage }, { status: 202 });
}
