import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { validateRun, ValidationError } from "@/lib/settings";
import { saveRunSettings } from "@/lib/settings-db";
import { serverDb } from "@/lib/supabase";

export async function PUT(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const input = validateRun(await req.json().catch(() => null));
    return NextResponse.json({ ok: true, ...(await saveRunSettings(serverDb(), input)) });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not save. Reload and check the values." }, { status: 500 });
  }
}
