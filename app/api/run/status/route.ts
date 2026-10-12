import { NextResponse } from "next/server";
import { lockState } from "@/lib/lock";
import { serverDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Progress of a run (the latest one, or ?runId=). Read-only and public, like the dashboard pages; it carries no secrets.
export async function GET(req: Request) {
  const db = serverDb();
  const runId = Number(new URL(req.url).searchParams.get("runId"));
  const q = db.from("runs").select("*");
  const [{ data }, lock] = await Promise.all([runId ? q.eq("id", runId).limit(1) : q.order("id", { ascending: false }).limit(1), lockState(db)]);
  const run = data?.[0] ?? null;
  if (run?.counts) {
    const { queue, draft_done, holder, started_ms, ...counts } = run.counts; // internal bookkeeping, not for display
    // older runs wrote the lock holder into the first step's text; it is nobody's business on a public page
    const steps = Array.isArray(counts.steps) ? counts.steps.map((st: any) => ({ ...st, detail: String(st.detail ?? "").replace(/,? holder \S+/g, "") })) : counts.steps;
    run.counts = { ...counts, steps, queue_left: Array.isArray(queue) ? queue.length : 0 };
  }
  return NextResponse.json({ run, lock: { locked: lock.locked, until: lock.until } });
}
