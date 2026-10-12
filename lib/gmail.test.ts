import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gmailDraftUrl, gmailLink, resolveGmailDraft } from "./gmail";

describe("Gmail links", () => {
  it("names the account and the message, so it opens that email in the right account", () => {
    expect(gmailDraftUrl("rohit@example.com", "18f3a9")).toBe("https://mail.google.com/mail/u/rohit%40example.com/#drafts?compose=18f3a9");
    expect(gmailDraftUrl(null, "18f3a9")).toBe("https://mail.google.com/mail/u/0/#drafts?compose=18f3a9");
    expect(gmailDraftUrl("rohit@example.com", null)).toBe("https://mail.google.com/mail/u/rohit%40example.com/#drafts");
    expect(gmailLink("r1:m2")).toContain("compose=m2");
    expect(gmailLink(null)).toBe("https://mail.google.com/mail/u/0/#drafts");
  });
});

describe("resolveGmailDraft", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "refresh");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const respond = (draft: { status: number; body?: unknown }) =>
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "t" }) } as Response;
      if (u.includes("/profile")) return { ok: true, status: 200, json: async () => ({ emailAddress: "rohit@example.com" }) } as Response;
      return { ok: draft.status < 300, status: draft.status, json: async () => draft.body } as Response;
    });

  it("is 'none' when the app never created a draft", async () => {
    expect(await resolveGmailDraft(null)).toEqual({ state: "none" });
  });
  it("is 'missing' when Gmail says 404 (deleted)", async () => {
    vi.stubGlobal("fetch", respond({ status: 404 }));
    expect(await resolveGmailDraft("r1:old")).toEqual({ state: "missing" });
  });
  it("returns the CURRENT message id, not the saved one", async () => {
    vi.stubGlobal("fetch", respond({ status: 200, body: { id: "r1", message: { id: "newmsg" } } }));
    const r = await resolveGmailDraft("r1:stale");
    expect(r).toMatchObject({ state: "ok", stored: "r1:newmsg" });
    expect((r as any).url).toMatch(/#drafts\?compose=newmsg$/);
  });
  it("throws on other Gmail errors instead of saying the draft is gone", async () => {
    vi.stubGlobal("fetch", respond({ status: 500 }));
    await expect(resolveGmailDraft("r1:m")).rejects.toThrow(/HTTP 500/);
  });
});
