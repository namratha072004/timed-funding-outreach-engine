import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorize, codeOk, COOKIE, cookieOk, expectedCookie } from "./auth";
import { proxy } from "../proxy";
import { PUT as putRubric } from "../app/api/settings/rubric/route";
import { PUT as putRun } from "../app/api/settings/run/route";
import { POST as postStatus } from "../app/api/drafts/[id]/status/route";
import { POST as postOverrule } from "../app/api/rejects/[id]/overrule/route";

const CODE = "unit-test-access-code";
const CRON = "unit-test-cron-secret";
beforeEach(() => {
  vi.stubEnv("ACCEPT_ANY_ACCESS_CODE", "false");
  vi.stubEnv("ACCESS_CODE", CODE);
  vi.stubEnv("CRON_SECRET", CRON);
});
afterEach(() => vi.unstubAllEnvs());

const req = (method: string, path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { method, headers });
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
const cookie = async () => `${COOKIE}=${await expectedCookie()}`;

describe("the access code is a real check", () => {
  it("accepts only ACCESS_CODE", async () => {
    expect(await codeOk(CODE)).toBe(true);
    expect(await codeOk("wrong")).toBe(false);
    expect(await codeOk("")).toBe(false);
    expect(await codeOk(CODE + " ")).toBe(false);
  });
  it("testing mode (ACCEPT_ANY_ACCESS_CODE=true) accepts any non-empty code, and only then", async () => {
    vi.stubEnv("ACCEPT_ANY_ACCESS_CODE", "true");
    expect(await codeOk("anything")).toBe(true);
    expect(await codeOk("   ")).toBe(false);
    expect(await codeOk("")).toBe(false);
    expect(await cookieOk(await expectedCookie())).toBe(true);
    vi.stubEnv("ACCEPT_ANY_ACCESS_CODE", "false");
    expect(await codeOk("anything")).toBe(false);
  });
  it("nothing unlocks when ACCESS_CODE is not set (testing mode off)", async () => {
    vi.stubEnv("ACCEPT_ANY_ACCESS_CODE", "false");
    vi.stubEnv("ACCESS_CODE", "");
    expect(await codeOk("")).toBe(false);
    expect(await codeOk("x")).toBe(false);
    expect(await cookieOk("anything")).toBe(false);
  });
  it("the cookie is a hash, never the code", async () => {
    const c = (await expectedCookie())!;
    expect(c).not.toContain(CODE);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(await cookieOk(c)).toBe(true);
    expect(await cookieOk(c.replace(/.$/, "0"))).toBe(false);
    expect(await cookieOk(CODE)).toBe(false);
  });
  it("authorize: cookie and bearer are separate doors", async () => {
    const withCookie = req("POST", "/x", { cookie: await cookie() });
    const withBearer = req("POST", "/x", { authorization: `Bearer ${CRON}` });
    expect(await authorize(withCookie, { cookie: true, bearer: false })).toBe(true);
    expect(await authorize(withCookie, { cookie: false, bearer: true })).toBe(false);
    expect(await authorize(withBearer, { cookie: false, bearer: true })).toBe(true);
    expect(await authorize(withBearer, { cookie: true, bearer: false })).toBe(false);
    expect(await authorize(req("POST", "/x", { authorization: "Bearer nope" }), { cookie: true, bearer: true })).toBe(false);
  });
});

describe("public read, protected writes (first gate: proxy)", () => {
  it("lets reads and the unlock call through with no credentials", async () => {
    expect(passes(await proxy(req("GET", "/api/run/status")))).toBe(true);
    expect(passes(await proxy(req("POST", "/api/unlock")))).toBe(true);
    expect(passes(await proxy(req("GET", "/api/drafts/12/gmail")))).toBe(true);
    expect((await proxy(req("POST", "/api/drafts/12/gmail"))).status).toBe(401);
    expect((await proxy(req("GET", "/api/drafts/12/recreate"))).status).toBe(401);
  });
  it("blocks every write without the cookie", async () => {
    for (const [m, p] of [["POST", "/api/run"], ["GET", "/api/run"], ["POST", "/api/drafts/1/status"], ["POST", "/api/rejects/1/overrule"], ["PUT", "/api/settings/rubric"], ["PUT", "/api/settings/run"], ["POST", "/api/run/stage"], ["POST", "/api/telegram/connect"], ["DELETE", "/api/telegram/connect"], ["POST", "/api/telegram/test"], ["PUT", "/api/telegram/enabled"], ["GET", "/api/account"], ["POST", "/api/drafts/1/recreate"]] as const) {
      const r = await proxy(req(m, p));
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });
  it("lets writes through with the cookie", async () => {
    const h = { cookie: await cookie() };
    for (const [m, p] of [["POST", "/api/run"], ["POST", "/api/drafts/1/status"], ["POST", "/api/rejects/1/overrule"], ["PUT", "/api/settings/rubric"], ["PUT", "/api/settings/run"], ["POST", "/api/telegram/connect"], ["GET", "/api/account"], ["POST", "/api/drafts/1/recreate"]] as const) {
      expect(passes(await proxy(req(m, p, h))), `${m} ${p}`).toBe(true);
    }
  });
  it("the cron bearer token opens only the run routes", async () => {
    const h = { authorization: `Bearer ${CRON}` };
    expect(passes(await proxy(req("GET", "/api/run", h)))).toBe(true);
    expect(passes(await proxy(req("POST", "/api/run/stage", h)))).toBe(true);
    expect((await proxy(req("PUT", "/api/settings/rubric", h))).status).toBe(401);
    expect((await proxy(req("POST", "/api/drafts/1/status", h))).status).toBe(401);
  });
  it("a wrong cookie or token is refused", async () => {
    expect((await proxy(req("POST", "/api/run", { cookie: `${COOKIE}=deadbeef` }))).status).toBe(401);
    expect((await proxy(req("GET", "/api/run", { authorization: "Bearer wrong" }))).status).toBe(401);
  });
});

describe("every write route checks again itself (second gate)", () => {
  it("answers 401 without the cookie, before touching the database", async () => {
    const ctx = { params: Promise.resolve({ id: "1" }) };
    expect((await putRubric(new Request("http://x/api/settings/rubric", { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await putRun(new Request("http://x/api/settings/run", { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await postStatus(new Request("http://x/api/drafts/1/status", { method: "POST", body: "{}" }), ctx)).status).toBe(401);
    expect((await postOverrule(new Request("http://x/api/rejects/1/overrule", { method: "POST" }), ctx)).status).toBe(401);
  });
  it("answers 400 with a clear message for an invalid save, even with the cookie", async () => {
    const h = { cookie: await cookie(), "content-type": "application/json" };
    const r = await putRun(new Request("http://x/api/settings/run", { method: "PUT", headers: h, body: JSON.stringify({ maxArticles: 0, maxGemini: 5, hunterLookups: 1, keywords: ["seed"] }) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Articles per run must be a whole number from 1 to 2000/);
  });
});
