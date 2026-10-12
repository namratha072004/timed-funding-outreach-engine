import Link from "next/link";
import { serverDb } from "@/lib/supabase";
import { telegramState } from "@/lib/telegram";

/** Tells anyone looking at the dashboard that new drafts trigger a Telegram reminder (and whether it is switched on). */
export default async function TelegramNote({ className = "" }: { className?: string }) {
  const { chat, enabled } = await telegramState(serverDb());
  const on = !!chat && enabled;
  return (
    <p className={className}>
      <b>Telegram reminder:</b> {on ? "on. A message arrives when new drafts are ready." : chat ? "paused. Turn it on in Settings." : "not connected yet. Connect it so a message arrives when new drafts are ready."}{" "}
      <Link href="/settings?tab=notifications">{on ? "Manage" : "Set it up"}</Link>
    </p>
  );
}
