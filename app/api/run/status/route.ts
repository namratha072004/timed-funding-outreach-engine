import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { lockState } from "@/lib/lock";
import { serverDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Progress of a run (the latest one, or ?runId=). Cookie for the dashboard, bearer token for GitHub Actions.
export async function GET(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serverDb();
  const runId = Number(new URL(req.url).searchParams.get("runId"));
  const q = db.from("runs").select("*");
  const [{ data }, lock] = await Promise.all([runId ? q.eq("id", runId).limit(1) : q.order("id", { ascending: false }).limit(1), lockState(db)]);
  const run = data?.[0] ?? null;
  if (run?.counts) {
    const { queue, draft_done, ...counts } = run.counts; // internal bookkeeping, not for display
    run.counts = { ...counts, queue_left: Array.isArray(queue) ? queue.length : 0 };
  }
  return NextResponse.json({ run, lock });
}
