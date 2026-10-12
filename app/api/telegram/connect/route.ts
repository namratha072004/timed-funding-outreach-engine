import { NextResponse } from "next/server";
import { deleteSetting, setSetting } from "@/lib/app-settings";
import { authorize } from "@/lib/auth";
import { findChat, sendTelegram, telegramToken } from "@/lib/telegram";
import { serverDb } from "@/lib/supabase";

const deny = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** Connects the chat of whoever pressed Start in the bot most recently, and says hello there. */
export async function POST(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return deny();
  if (!telegramToken()) return NextResponse.json({ error: "The bot token is not set yet. Add TELEGRAM_BOT_TOKEN in Vercel, redeploy, then try again." }, { status: 400 });
  try {
    const chat = await findChat();
    if (!chat) return NextResponse.json({ error: "No chat found. Open the bot in Telegram, press Start, then press Connect again." }, { status: 404 });
    await sendTelegram(chat.id, "Connected. You will get a message here when new startup drafts are ready to review. Nothing is ever sent without you.");
    const db = serverDb();
    await setSetting(db, "telegram_chat", chat);
    await setSetting(db, "telegram_enabled", true);
    return NextResponse.json({ ok: true, name: chat.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not connect." }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!(await authorize(req, { cookie: true, bearer: false }))) return deny();
  const db = serverDb();
  await deleteSetting(db, "telegram_chat");
  return NextResponse.json({ ok: true });
}
