import { NextResponse, after } from "next/server";
import { authorize } from "@/lib/auth";
import { driveStage, startRun } from "@/lib/run";
import { serverDb } from "@/lib/supabase";

// The run is a chain of stages; each stage is its own function invocation with its own allowance (Hobby: 300 s).
// This route only takes the lock, creates the run, answers at once, and starts the first stage in the background.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function start(req: Request, trigger: "cron" | "manual") {
  const db = serverDb();
  const run = await startRun(db, trigger);
  if (run.status === "skipped" || run.runId == null) return NextResponse.json({ status: "skipped", reason: "already running", runId: run.runId }, { status: 409 });
  const origin = new URL(req.url).origin;
  const runId = run.runId;
  after(() => driveStage(db, runId, "ingest", origin));
  return NextResponse.json({ status: "started", runId }, { status: 202 });
}

// GitHub Actions (every 3 hours) calls GET with the bearer token. A GET cannot use the cookie (it could be triggered by a link).
export async function GET(req: Request) {
  if (!(await authorize(req, { cookie: false, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return start(req, "cron");
}

// The dashboard's Run now button: access cookie (or the bearer token).
export async function POST(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return start(req, "manual");
}
