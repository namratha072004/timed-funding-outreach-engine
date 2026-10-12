"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";
import { Card, StatusPill } from "./ui";

type Props = { tokenSet: boolean; bot: { username: string | null; name: string } | null; connected: boolean; enabled: boolean };

/** Telegram reminders. The bot token is never shown or handled here: it lives in the server's environment. */
export default function NotificationsPanel({ tokenSet, bot, connected, enabled }: Props) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(name: string, run: () => Promise<Response>, why: string, done: (j: any) => string) {
    setBusy(name);
    const r = await guard(run, why);
    setBusy(null);
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    toast(r.ok ? done(j) : j.error ?? `Failed (HTTP ${r.status}).`);
    if (r.ok) router.refresh();
  }
  const why = "Changing notifications changes settings, so it needs the code.";
  const json = { "content-type": "application/json" };

  return (
    <>
      <section className="sect">
        <h2>Telegram reminders</h2>
        <div className="sub">Get a Telegram message when a run writes new startup drafts. It lists the startups and links to Drafts. It never includes email addresses or draft text, and nothing is sent without you.</div>
        <Card>
          <div className="fld">
            <div className="l"><b>Bot</b><p>{tokenSet ? (bot ? `Ready: ${bot.name}${bot.username ? ` (@${bot.username})` : ""}.` : "A token is set, but Telegram did not answer. Check the token.") : "Not set up yet. Follow the steps below."}</p></div>
            <StatusPill tone={tokenSet && bot ? "ok" : tokenSet ? "warn" : "neutral"}>{tokenSet && bot ? "Token set" : tokenSet ? "Check token" : "No token"}</StatusPill>
          </div>
          <div className="fld">
            <div className="l"><b>Your chat</b><p>{connected ? "Connected. Reminders go to your Telegram." : "Not connected. Press Start in the bot, then press Connect."}</p></div>
            <div className="actions">
              <StatusPill tone={connected ? "ok" : "neutral"}>{connected ? "Connected" : "Not connected"}</StatusPill>
              <button className="btn" disabled={!tokenSet || busy !== null} onClick={() => act("connect", () => fetch("/api/telegram/connect", { method: "POST" }), why, (j) => `Connected to ${j.name}. A hello message was sent.`)}>{busy === "connect" ? "Connecting…" : connected ? "Reconnect" : "Connect Telegram"}</button>
            </div>
          </div>
          <div className="fld">
            <div className="l"><b>Send me a reminder when new drafts are ready</b><p>Turn off to pause reminders without disconnecting.</p></div>
            <label className="sw">
              <input type="checkbox" checked={enabled} disabled={!connected || busy !== null} onChange={(e) => act("toggle", () => fetch("/api/telegram/enabled", { method: "PUT", headers: json, body: JSON.stringify({ enabled: e.target.checked }) }), why, () => (e.target.checked ? "Reminders are on." : "Reminders are paused."))} /> On
            </label>
          </div>
          <div className="fld">
            <div className="l"><b>Test it</b><p>Sends one message to your chat so you can see what a reminder looks like.</p></div>
            <div className="actions">
              <button className="btn" disabled={!connected || busy !== null} onClick={() => act("test", () => fetch("/api/telegram/test", { method: "POST" }), why, () => "Test message sent. Check Telegram.")}>{busy === "test" ? "Sending…" : "Send test message"}</button>
              {connected && <button className="btn" disabled={busy !== null} onClick={() => act("off", () => fetch("/api/telegram/connect", { method: "DELETE" }), why, () => "Telegram disconnected.")}>Disconnect</button>}
            </div>
          </div>
        </Card>
      </section>

      <section className="sect">
        <h2>How to set it up</h2>
        <div className="sub">Four steps, about two minutes.</div>
        <Card>
          <div className="fld"><div className="l"><b>1. Make a bot</b><p>In Telegram open @BotFather, send /newbot, and follow the questions. It gives you a token (a long text). Keep it private.</p></div></div>
          <div className="fld"><div className="l"><b>2. Give the app the token</b><p>In Vercel, add it as the environment variable TELEGRAM_BOT_TOKEN and redeploy. The token is never shown on this page.</p></div></div>
          <div className="fld"><div className="l"><b>3. Say hello to your bot</b><p>{bot?.username ? <>Open <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)", fontWeight: 600 }}>t.me/{bot.username} ↗</a> and press Start.</> : "Open your bot in Telegram and press Start."}</p></div></div>
          <div className="fld"><div className="l"><b>4. Press Connect Telegram</b><p>Above. The app finds your chat, saves it and says hello there.</p></div></div>
        </Card>
      </section>
    </>
  );
}
