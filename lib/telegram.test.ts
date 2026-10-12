import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findChat, formatNewDrafts, notifyNewDrafts, sendTelegram } from "./telegram";

const TOKEN = "123456789:AAH-unit_test_token_value";
beforeEach(() => vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reply = (body: unknown, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => body }) as Response);

describe("reminder text", () => {
  it("names the startups, links to Drafts, never mentions emails or draft text", () => {
    const t = formatNewDrafts([{ name: "Zomint", stage: "seed", amount: "Rs 36 crore" }, { name: "CurvetAI", stage: null, amount: null }], "https://app.example/drafts");
    expect(t).toContain("2 new startup drafts are ready to review.");
    expect(t).toContain("• Zomint (seed, Rs 36 crore)");
    expect(t).toContain("• CurvetAI");
    expect(t).toContain("Open Drafts: https://app.example/drafts");
    expect(t).toContain("Nothing is sent without you.");
    expect(t).not.toMatch(/@|Subject/);
  });
  it("singular, and a cap of eight names", () => {
    expect(formatNewDrafts([{ name: "A", stage: null, amount: null }], null)).toContain("1 new startup draft is ready to review.");
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, stage: null, amount: null }));
    const t = formatNewDrafts(many, null);
    expect(t).toContain("• S7");
    expect(t).not.toContain("• S8");
    expect(t).toContain("…and 3 more");
  });
});

describe("Telegram calls", () => {
  it("sends to the stored chat with the token only in the URL", async () => {
    const f = reply({ ok: true, result: {} });
    vi.stubGlobal("fetch", f);
    await sendTelegram(42, "hello");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: 42, text: "hello" });
    expect(String(init.body)).not.toContain(TOKEN);
  });
  it("never lets the token into an error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/sendMessage`); }));
    const err = await sendTelegram(1, "x").catch((e: Error) => e.message);
    expect(err).not.toContain(TOKEN);
    expect(err).not.toContain("AAH-unit_test");
    vi.stubGlobal("fetch", reply({ ok: false, description: "Forbidden: bot was blocked by the user" }, false, 403));
    expect(await sendTelegram(1, "x").catch((e: Error) => e.message)).toBe("Telegram sendMessage failed: Forbidden: bot was blocked by the user");
  });
  it("fails clearly with no token", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await expect(sendTelegram(1, "x")).rejects.toThrow(/not set/);
  });
  it("finds the latest private chat that pressed Start, ignoring groups", async () => {
    vi.stubGlobal("fetch", reply({ ok: true, result: [
      { message: { chat: { id: 7, type: "private", first_name: "Old", last_name: "Chat" } } },
      { message: { chat: { id: 99, type: "private", first_name: "Rohit" } } },
      { message: { chat: { id: -100, type: "group", title: "Team" } } },
    ] }));
    expect(await findChat()).toEqual({ id: 99, name: "Rohit" });
    vi.stubGlobal("fetch", reply({ ok: true, result: [] }));
    expect(await findChat()).toBeNull();
  });
});

// a tiny stand-in for the Supabase client: every query resolves to the rows given for its table
function fakeDb(tables: Record<string, any>) {
  const updates: [string, any][] = [];
  const db = {
    updates,
    from(t: string) {
      let key = "";
      const q: any = {
        select: () => q, in: () => q, not: () => q, gte: () => q,
        eq: (_c: string, v: string) => ((key = v), q),
        single: async () => ({ data: tables[t] }),
        maybeSingle: async () => ({ data: tables.app_settings && key in tables.app_settings ? { value: tables.app_settings[key] } : null }),
        update: (v: any) => (updates.push([t, v]), q),
        then: (res: any) => res({ data: tables[t] }),
      };
      return q;
    },
  };
  return db;
}

describe("notifyNewDrafts", () => {
  const drafts = [{ startups: { name: "Zomint", stage_label: "seed", amount_text: "Rs 36 crore" } }];
  const settings = { telegram_chat: { id: 5, name: "Rohit" }, telegram_enabled: true };
  const run = (extra = {}) => ({ counts: { drafted: 1, started_ms: Date.now() - 60_000, ...extra } });

  it("sends one reminder for the drafts a run wrote, and marks the run so it is not sent twice", async () => {
    const f = reply({ ok: true, result: {} });
    vi.stubGlobal("fetch", f);
    const db = fakeDb({ runs: run(), drafts, app_settings: settings });
    expect(await notifyNewDrafts(db as any, 1, "https://app.example")).toBe("sent");
    expect(JSON.parse(String((f.mock.calls[0] as any)[1].body)).text).toContain("Zomint");
    expect(db.updates[0]![1].counts.telegram_notified).toBe(true);
    const again = fakeDb({ runs: run({ telegram_notified: true }), drafts, app_settings: settings });
    expect(await notifyNewDrafts(again as any, 1, null)).toBe("none");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("stays quiet when there are no new drafts, no chat, or reminders are paused", async () => {
    const f = reply({ ok: true, result: {} });
    vi.stubGlobal("fetch", f);
    expect(await notifyNewDrafts(fakeDb({ runs: run({ drafted: 0 }), drafts, app_settings: settings }) as any, 1, null)).toBe("none");
    expect(await notifyNewDrafts(fakeDb({ runs: run(), drafts, app_settings: {} }) as any, 1, null)).toBe("off");
    expect(await notifyNewDrafts(fakeDb({ runs: run(), drafts, app_settings: { ...settings, telegram_enabled: false } }) as any, 1, null)).toBe("off");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await notifyNewDrafts(fakeDb({ runs: run(), drafts, app_settings: settings }) as any, 1, null)).toBe("off");
    expect(f).not.toHaveBeenCalled();
  });
  it("never throws: a failed send is reported, not raised", async () => {
    vi.stubGlobal("fetch", reply({ ok: false, description: "Bad Request: chat not found" }, false, 400));
    expect(await notifyNewDrafts(fakeDb({ runs: run(), drafts, app_settings: settings }) as any, 1, null)).toBe("failed");
  });
});
