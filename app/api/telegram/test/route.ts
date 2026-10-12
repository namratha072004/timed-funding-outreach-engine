import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { sendTelegram, telegramState } from "@/lib/telegram";
import { serverDb } from "@/lib/supabase";

export async function POST(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { chat } = await telegramState(serverDb());
  if (!chat) return NextResponse.json({ error: "Telegram is not connected yet." }, { status: 400 });
  try {
    await sendTelegram(chat.id, "Test message from Funding Outreach. Reminders about new drafts will look like this.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not send." }, { status: 502 });
  }
}
