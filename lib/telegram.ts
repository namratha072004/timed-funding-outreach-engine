import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./app-settings";

/**
 * Telegram reminders. The bot token is an environment variable (TELEGRAM_BOT_TOKEN) and never leaves the server;
 * which chat to write to, and whether reminders are on, live in app_settings. A reminder is plain text with startup
 * names only (no email addresses, no draft text). Nothing here sends email.
 */
const API = "https://api.telegram.org";

export const telegramToken = (): string | null => process.env.TELEGRAM_BOT_TOKEN?.trim() || null;

/** Telegram puts the token in the URL, so any error text is scrubbed before it can be shown or logged. */
const scrub = (s: string) => {
  const t = telegramToken();
  return (t ? s.split(t).join("***") : s).replace(/bot\d+:[\w-]+/g, "bot***");
};

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15_000) });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(`Telegram ${method} failed: ${j?.description ?? `HTTP ${r.status}`}`);
    return j.result as T;
  } catch (e) {
    throw new Error(scrub(e instanceof Error ? e.message : String(e)));
  }
}

export type TgChat = { id: number; name: string };

export async function botInfo(): Promise<{ username: string | null; name: string } | null> {
  if (!telegramToken()) return null;
  try {
    const me = await call<{ username?: string; first_name: string }>("getMe");
    return { username: me.username ?? null, name: me.first_name };
  } catch {
    return null;
  }
}

let botCache: { at: number; v: Awaited<ReturnType<typeof botInfo>> } | null = null;
/** Cached for 5 minutes and cut off after 4 s: the Settings page is public, so a page view must not hammer Telegram. */
export async function botInfoCached(): Promise<Awaited<ReturnType<typeof botInfo>>> {
  if (botCache && Date.now() - botCache.at < 300_000) return botCache.v;
  const v = await Promise.race([botInfo(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  if (v) botCache = { at: Date.now(), v };
  return v;
}

/** The most recent private chat that wrote to the bot (the person pressed Start). */
export async function findChat(): Promise<TgChat | null> {
  const updates = await call<any[]>("getUpdates", { limit: 100, allowed_updates: ["message"] });
  for (const u of [...updates].reverse()) {
    const c = u?.message?.chat;
    if (c?.type === "private" && typeof c.id === "number") return { id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "Telegram user" };
  }
  return null;
}

export async function sendTelegram(chatId: number, text: string): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

export type DraftLine = { name: string; stage: string | null; amount: string | null };

/** The reminder text. Pure. */
export function formatNewDrafts(items: DraftLine[], link: string | null): string {
  const n = items.length;
  const shown = items.slice(0, 8).map((d) => `• ${d.name}${[d.stage, d.amount].filter(Boolean).length ? ` (${[d.stage, d.amount].filter(Boolean).join(", ")})` : ""}`);
  return [
    n === 1 ? "1 new startup draft is ready to review." : `${n} new startup drafts are ready to review.`,
    "",
    ...shown,
    ...(n > 8 ? [`…and ${n - 8} more`] : []),
    "",
    link ? `Open Drafts: ${link}` : "Open the Drafts page to review them.",
    "Nothing is sent without you.",
  ].join("\n");
}

export type TelegramState = { chat: TgChat | null; enabled: boolean };
export async function telegramState(db: SupabaseClient): Promise<TelegramState> {
  const [chat, enabled] = await Promise.all([getSetting<TgChat | null>(db, "telegram_chat", null), getSetting<boolean>(db, "telegram_enabled", true)]);
  return { chat, enabled };
}

/**
 * After a run finishes: one reminder listing the drafts that run wrote. Sent at most once per run, never throws
 * (a failed reminder must not fail the run), and does nothing if there is no token, no chat, reminders are off, or no new drafts.
 */
export async function notifyNewDrafts(db: SupabaseClient, runId: number, origin: string | null): Promise<"sent" | "none" | "off" | "failed"> {
  try {
    if (!telegramToken()) return "off";
    const { data: run } = await db.from("runs").select("counts").eq("id", runId).single();
    const c = run?.counts ?? {};
    if (c.telegram_notified || !(c.drafted > 0)) return "none";
    const { chat, enabled } = await telegramState(db);
    if (!chat || !enabled) return "off";
    const since = new Date(c.started_ms ?? Date.now() - 3_600_000).toISOString();
    const { data } = await db.from("drafts").select("startups(name,stage_label,amount_text)").in("status", ["new", "pending_gmail"]).not("subject", "is", null).gte("updated_at", since);
    const items: DraftLine[] = (data ?? []).map((d: any) => d.startups).filter(Boolean).map((s: any) => ({ name: s.name, stage: s.stage_label, amount: s.amount_text }));
    if (!items.length) return "none";
    await sendTelegram(chat.id, formatNewDrafts(items, origin ? `${origin}/drafts` : null));
    await db.from("runs").update({ counts: { ...c, telegram_notified: true } }).eq("id", runId);
    return "sent";
  } catch {
    return "failed";
  }
}
