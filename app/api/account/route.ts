import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";

/** 401 until the access code has been entered; the Account page uses it to sign in. */
export async function GET(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
