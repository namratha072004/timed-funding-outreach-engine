import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { validateRubric, ValidationError } from "@/lib/settings";
import { saveRubric } from "@/lib/settings-db";
import { serverDb } from "@/lib/supabase";

export async function PUT(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serverDb();
  try {
    const { data } = await db.from("rubric_criteria").select("key").eq("active", true);
    const input = validateRubric(await req.json().catch(() => null), (data ?? []).map((c: any) => c.key));
    const r = await saveRubric(db, input);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not save. Nothing was changed that you can rely on; reload and check." }, { status: 500 });
  }
}
