import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { lockState } from "@/lib/lock";
import { serverDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serverDb();
  const [{ data }, lock] = await Promise.all([db.from("runs").select("*").order("id", { ascending: false }).limit(1), lockState(db)]);
  return NextResponse.json({ run: data?.[0] ?? null, lock });
}
