import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { executeRun } from "@/lib/run";
import { serverDb } from "@/lib/supabase";

// Hobby plan hard limit is 300 s. The run itself stops starting new work at 240 s.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handle(req: Request, trigger: "cron" | "manual") {
  const result = await executeRun(serverDb(), { trigger });
  return NextResponse.json({ runId: result.runId, status: result.status, counts: { ...result.counts, steps: undefined }, errors: result.errors.length }, { status: result.status === "skipped" ? 409 : 200 });
}

// Vercel Cron calls GET with the bearer token. A GET cannot use the cookie (it could be triggered by a link).
export async function GET(req: Request) {
  if (!(await authorize(req, { cookie: false, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handle(req, "cron");
}

// The dashboard's Run now button: access cookie (or the bearer token).
export async function POST(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: true }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handle(req, "manual");
}
