import { NextResponse } from "next/server";
import { setSetting } from "@/lib/app-settings";
import { authorize } from "@/lib/auth";
import { serverDb } from "@/lib/supabase";

export async function PUT(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  await setSetting(serverDb(), "telegram_enabled", body.enabled);
  return NextResponse.json({ ok: true });
}
