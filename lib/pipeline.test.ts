import { afterEach, describe, expect, it, vi } from "vitest";
import { domainCandidates, orgMatches, robotsAllows, verifyWebsite, type Contact } from "./contacts";
import { resolveOutreach, validateDraft, writeDraft, type DraftContext } from "./draft";
import { parseFeed } from "./feeds";
import { filterItem, keywordMatcher } from "./filter";
import { geminiRaw, Budget, resetExhausted, retryAfterSeconds } from "./gemini";
import { buildRaw } from "./gmail";
import { matchExisting, pool } from "./memory";
import { checkUrl, isBlockedIp } from "./ssrf";
import { canonicalUrl, domainOf, emailsOnDomain, externalLinks, guessNameFromTitle, nameKey } from "./text";
import { decideStored } from "./run";
import { rubric } from "./fixtures";

describe("canonicalUrl / nameKey / domain (dedupe keys)", () => {
  it("collapses tracking params, www, fragments, trailing slash", () => {
    const a = canonicalUrl("https://www.Inc42.com/buzz/zaperon-raises/?utm_source=x&b=2&a=1#top");
    const b = canonicalUrl("http://inc42.com/buzz/zaperon-raises?a=1&b=2");
    expect(a).toBe(b);
    expect(a).toBe("https://inc42.com/buzz/zaperon-raises?a=1&b=2");
  });
  it("rejects non-http urls", () => {
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalUrl("ftp://x.com/a")).toBeNull();
  });
  it("nameKey ignores case, punctuation and legal suffixes", () => {
    expect(nameKey("Zaperon Technologies Pvt. Ltd.")).toBe(nameKey("ZAPERON"));
    expect(nameKey("OFF/BEAT")).toBe("off beat");
    expect(nameKey("Labs")).toBe("labs");
  });
  it("domainOf strips www and rejects junk", () => {
    expect(domainOf("https://www.zaperon.com/about")).toBe("zaperon.com");
    expect(domainOf("zaperon.in")).toBe("zaperon.in");
    expect(domainOf("not a url")).toBeNull();
  });
  it("guessNameFromTitle", () => {
    expect(guessNameFromTitle("Zaperon raises $2 Mn in seed round led by X")).toBe("Zaperon");
    expect(guessNameFromTitle("Weekly funding roundup")).toBeNull();
  });
});

describe("domainCandidates", () => {
  it("builds name-based domains and skips tiny names", () => {
    expect(domainCandidates("Sorry Sugar")).toEqual(["sorrysugar.com", "sorrysugar.in", "sorrysugar.ai", "sorrysugar.io", "sorrysugar.co"]);
    expect(domainCandidates("Zi")).toEqual([]);
  });
});

describe("orgMatches (guarded Hunter use on a guessed domain)", () => {
  it("accepts the same company and rejects a different one", () => {
    expect(orgMatches("Zomint", "Zomint")).toBe(true);
    expect(orgMatches("Zomint Technologies Pvt Ltd", "Zomint")).toBe(true);
    expect(orgMatches("Arrowhead Pharmaceuticals", "Arrowhead AI")).toBe(false);
    expect(orgMatches(null, "Zomint")).toBe(false);
    expect(orgMatches("Zi", "Zi")).toBe(false);
  });
});

describe("externalLinks (startup website candidates)", () => {
  const html = `<nav><a href="/about">About</a><a href="https://twitter.com/inc42">tw</a></nav>
    <article><p>Read <a href="https://www.zaperon.com/">Zaperon</a> and <a href="https://zaperon.com/blog">blog</a>, <a href="https://linkedin.com/company/z">LinkedIn</a>, <a href="https://inc42.com/other">more</a>.</p></article>`;
  it("keeps one external, non-social, non-publisher link per domain from the article body", () => {
    expect(externalLinks(html, "https://inc42.com/buzz/x", ["inc42.com"])).toEqual(["https://www.zaperon.com"]);
  });
});

describe("startup dedupe (matchExisting)", () => {
  const ex = [
    { id: 1, name_key: "zaperon", domain: "zaperon.com" },
    { id: 2, name_key: "gharbar", domain: null },
  ];
  it("matches by domain even when the name differs", () => expect(matchExisting(ex, { name_key: "zaperon ai", domain: "zaperon.com" })?.id).toBe(1));
  it("matches by name key", () => expect(matchExisting(ex, { name_key: "gharbar", domain: "gharbar.in" })?.id).toBe(2));
  it("does not match different companies that share a name but have different domains", () => expect(matchExisting(ex, { name_key: "zaperon", domain: "zaperon.io" })).toBeUndefined());
  it("returns nothing for a new startup", () => expect(matchExisting(ex, { name_key: "new co", domain: null })).toBeUndefined());
});

describe("keyword filter (whole words, case-insensitive)", () => {
  const m = keywordMatcher(["seed", "pre-seed", "mn", "led by", "raises"]);
  it("matches whole words", () => {
    expect(m("Startup RAISES $2 Mn")).toBe(true);
    expect(m("closes pre seed round")).toBe(true);
    expect(m("round led   by Peak XV")).toBe(true);
  });
  it("does not match inside other words", () => {
    expect(m("mnemonic seedling cultivation")).toBe(false);
    expect(m("The seeds of change")).toBe(false);
  });
  it("filterItem drops no-keyword and old items, keeps unknown dates", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    const o = { match: m, lookbackHours: 24, now, checkKeywords: true };
    expect(filterItem({ title: "Weather today", publishedAt: now }, o)).toEqual({ keep: false, reason: "no funding keyword" });
    expect(filterItem({ title: "X raises seed", publishedAt: new Date("2026-10-10T00:00:00Z") }, o)).toEqual({ keep: false, reason: "older than 24h" });
    expect(filterItem({ title: "X raises seed", publishedAt: null }, o)).toEqual({ keep: true });
    expect(filterItem({ title: "X raises seed", publishedAt: now }, { ...o, lookbackHours: 24 })).toEqual({ keep: true });
  });
});

describe("ssrf", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
  it("checkUrl blocks non-http, localhost and private literals", () => {
    expect(() => checkUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => checkUrl("http://localhost:3000")).toThrow();
    expect(() => checkUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => checkUrl("http://[::1]/")).toThrow();
    expect(checkUrl("https://example.com/a").hostname).toBe("example.com");
  });
});

describe("feeds", () => {
  it("parses RSS, Atom and news sitemaps", () => {
    const rss = `<rss><channel><item><title>A raises seed</title><link>https://x.com/a?utm_source=z</link><pubDate>Mon, 12 Oct 2026 03:00:00 GMT</pubDate><description>&lt;p&gt;Hello&lt;/p&gt;</description></item></channel></rss>`;
    const [r] = parseFeed(rss, "X");
    expect(r).toMatchObject({ url: "https://x.com/a", title: "A raises seed", summary: "Hello", source: "X" });
    expect(r!.publishedAt?.toISOString()).toBe("2026-10-12T03:00:00.000Z");
    const atom = `<feed><entry><title>B</title><link rel="alternate" href="https://y.com/b"/><published>2026-10-12T01:00:00Z</published></entry></feed>`;
    expect(parseFeed(atom, "Y")[0]).toMatchObject({ url: "https://y.com/b", title: "B" });
    const sm = `<urlset><url><loc>https://z.com/c</loc><news:news><news:publication_date>2026-10-12T02:00:00Z</news:publication_date><news:title>C raises</news:title></news:news></url></urlset>`;
    expect(parseFeed(sm, "Z")[0]).toMatchObject({ url: "https://z.com/c", title: "C raises" });
  });
  it("handles a single item (not an array) and junk", () => {
    expect(parseFeed("<rss><channel><item><title>T</title><link>https://a.com/1</link></item></channel></rss>", "S")).toHaveLength(1);
    expect(parseFeed("<html></html>", "S")).toEqual([]);
  });
});

describe("contacts", () => {
  it("finds only emails on the startup's own domain", () => {
    const html = `<a href="mailto:Hello@zaperon.com">x</a> founders@zaperon.com other@gmail.com logo@zaperon.com.png team@mail.zaperon.com`;
    expect(emailsOnDomain(html, "zaperon.com").sort()).toEqual(["founders@zaperon.com", "hello@zaperon.com", "team@mail.zaperon.com"]);
  });
  it("robots.txt: disallow, allow override, agent-specific groups", () => {
    const r = "User-agent: *\nDisallow: /contact\nAllow: /contact/public\n\nUser-agent: outreachengine\nDisallow: /private";
    expect(robotsAllows(r, "/contact")).toBe(true); // specific group for us applies, which only blocks /private
    expect(robotsAllows(r, "/private")).toBe(false);
    const star = "User-agent: *\nDisallow: /contact\nAllow: /contact/public";
    expect(robotsAllows(star, "/contact")).toBe(false);
    expect(robotsAllows(star, "/contact/public")).toBe(true);
    expect(robotsAllows(star, "/about")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/x")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/x")).toBe(false);
  });
  it("verifyWebsite needs the domain to appear in the text or links", () => {
    expect(verifyWebsite("https://zaperon.com", "Visit zaperon.com today", [], ["inc42.com"])).toEqual({ domain: "zaperon.com", url: "https://zaperon.com" });
    expect(verifyWebsite("https://zaperon.com", "no site here", ["https://zaperon.com/x"], ["inc42.com"])?.domain).toBe("zaperon.com");
    expect(verifyWebsite("https://made-up.com", "nothing", [], ["inc42.com"])).toBeNull();
    expect(verifyWebsite("https://inc42.com/a", "inc42.com", [], ["inc42.com"])).toBeNull(); // publisher is not the startup
    expect(verifyWebsite("https://linkedin.com/company/x", "linkedin.com/company/x", [], [])).toBeNull();
  });
});

const hunter: Contact = { email: "ceo@zaperon.com", name: "A", role: "CEO", source: "hunter", verified: true };
const page: Contact = { email: "hello@zaperon.com", name: null, role: null, source: "contact_page", verified: false };
const GOOD = "Hi there,\n\nCongratulations on the round. Your wafer-level tool caught our eye.\n\nI am [SENDER NAME] at [ACCELERATOR NAME]. [PROGRAM DESCRIPTION]\n\n[CALL TO ACTION]\n\n[SENDER NAME]";
const ctx = (over = {}) => ({ contacts: [hunter, page], emptyKeys: ["sender_name", "accelerator_name", "program_description", "call_to_action"], ...over });

describe("draft validation (code-enforced rules)", () => {
  const ok = { subject: "Congratulations, Zaperon", body: GOOD, chosenContact: "ceo@zaperon.com", inferredPoints: [] };
  it("accepts a good draft", () => expect(validateDraft(ok, ctx())).toEqual([]));
  it("rejects bodies over 150 words", () => expect(validateDraft({ ...ok, body: GOOD + " word".repeat(150) }, ctx()).join()).toMatch(/max 150/));
  it.each(["We will fund you.", "We can invest in your next round.", "Funding is available for you.", "We guarantee a spot.", "Sign our term sheet."])("rejects funding promise: %s", (s) =>
    expect(validateDraft({ ...ok, body: `${GOOD}\n${s}` }, ctx()).join()).toMatch(/funding/));
  it.each(["Raised in the last 30 days, so timing is right.", "within 60 days of raising", "this window matters", "thirty days after"])("rejects window mention: %s", (s) =>
    expect(validateDraft({ ...ok, body: `${GOOD}\n${s}` }, ctx()).join()).toMatch(/window/));
  it("requires a visible placeholder for each empty outreach setting", () => {
    expect(validateDraft({ ...ok, body: "Hi there, congratulations." }, ctx()).join()).toMatch(/missing placeholder \[SENDER NAME\]/);
    expect(validateDraft({ ...ok, body: "Hi there, congratulations. Sender X" }, ctx({ emptyKeys: [] }))).toEqual([]);
  });
  it("chosen_contact must be in the supplied list or null", () => {
    expect(validateDraft({ ...ok, chosenContact: "invented@zaperon.com" }, ctx()).join()).toMatch(/not in the supplied list/);
    expect(validateDraft({ ...ok, chosenContact: null }, ctx())).toEqual([]);
  });
  it("rejects an email address in the text that was not supplied", () => {
    expect(validateDraft({ ...ok, body: GOOD + "\nwrite to ceo2@zaperon.com" }, ctx()).join()).toMatch(/not supplied/);
    expect(validateDraft({ ...ok, body: GOOD + "\nwrite to ceo@zaperon.com" }, ctx())).toEqual([]);
  });
  it("resolveOutreach turns empty values into placeholders", () => {
    const r = resolveOutreach({ sender_name: "Rohit", accelerator_name: "", program_description: "  ", call_to_action: "", style_notes: "" });
    expect(r.values.accelerator_name).toBe("[ACCELERATOR NAME]");
    expect(r.values.sender_name).toBe("Rohit");
    expect(r.emptyKeys).toEqual(["accelerator_name", "program_description", "call_to_action"]);
  });
});

describe("writeDraft retry and never-invent guarantees", () => {
  const dctx: DraftContext = { startup: { name: "Zaperon", sector: null, location: null, stage: "seed", amountText: null, investors: [], founders: [], description: null }, articleText: "t", homepageText: "", contacts: [hunter], outreach: {} };
  const answer = (over: any = {}) => ({ subject: "Congrats", body: GOOD, chosen_contact: "ceo@zaperon.com", inferred_points: [], ...over });
  it("retries once with the problems, then succeeds", async () => {
    const gen = vi.fn().mockResolvedValueOnce(answer({ body: "too short, no placeholders" })).mockResolvedValueOnce(answer());
    const out = await writeDraft(dctx, gen as any);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1]![0].prompt).toMatch(/missing placeholder/);
    expect(out.chosenContact).toBe("ceo@zaperon.com");
  });
  it("fails after two bad attempts (becomes draft_failed upstream)", async () => {
    const gen = vi.fn().mockResolvedValue(answer({ chosen_contact: "made.up@evil.com" }));
    await expect(writeDraft(dctx, gen as any)).rejects.toThrow(/not in the supplied list/);
    expect(gen).toHaveBeenCalledTimes(2);
  });
  it("respects the Gemini call budget", async () => {
    const gen = vi.fn();
    await expect(writeDraft(dctx, gen as any, () => false)).rejects.toThrow(/budget/);
    expect(gen).not.toHaveBeenCalled();
  });
});

describe("gmail raw message", () => {
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
  it("includes To only when given", () => {
    expect(decode(buildRaw({ to: "a@b.com", subject: "Hi", body: "x" }))).toMatch(/^To: a@b\.com\r\n/);
    expect(decode(buildRaw({ to: null, subject: "Hi", body: "x" }))).not.toMatch(/^To:/m);
  });
  it("strips header injection and encodes non-ASCII subjects", () => {
    const m = decode(buildRaw({ to: null, subject: "Hi\r\nBcc: evil@x.com", body: "x" }));
    expect(m).not.toMatch(/^Bcc:/m);
    expect(decode(buildRaw({ to: null, subject: "Congrats – Zaperon", body: "x" }))).toMatch(/=\?UTF-8\?B\?/);
  });
});

describe("gemini retry with backoff", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = () => Object.assign(process.env, { GEMINI_API_KEY: "k", GEMINI_MODEL: "m", GEMINI_BASE_URL: "https://x.test/v1" });
  const res = (status: number, body: any = {}) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
  it("retries 429 and 503, then returns the answer", async () => {
    env();
    const f = vi.fn().mockResolvedValueOnce(res(429, { error: { status: "RESOURCE_EXHAUSTED" } })).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { ok: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await geminiRaw({ prompt: "p" }, { baseDelayMs: 1 })).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry a 400/403", async () => {
    env();
    const f = vi.fn().mockResolvedValue(res(403, { error: { status: "PERMISSION_DENIED" } }));
    vi.stubGlobal("fetch", f);
    await expect(geminiRaw({ prompt: "p" }, { baseDelayMs: 1 })).rejects.toThrow(/403/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("gives up after the retry limit", async () => {
    env();
    const f = vi.fn().mockResolvedValue(res(503));
    vi.stubGlobal("fetch", f);
    await expect(geminiRaw({ prompt: "p" }, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(/Gemini failed/);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("falls back to the next model when the daily quota is used up", async () => {
    env();
    process.env.GEMINI_FALLBACK_MODELS = "m2";
    resetExhausted();
    const f = vi.fn((url: string) => Promise.resolve(url.includes("/m:") ? res(429, { error: { status: "RESOURCE_EXHAUSTED", message: "limit: 20 GenerateRequestsPerDayPerProjectPerModel-FreeTier" } }) : res(200, { from: "m2" })));
    vi.stubGlobal("fetch", f);
    expect(await geminiRaw({ prompt: "p" }, { baseDelayMs: 1 })).toEqual({ from: "m2" });
    expect(f).toHaveBeenCalledTimes(2); // no retries wasted on the exhausted model
    // and the exhausted model is skipped next time
    expect(await geminiRaw({ prompt: "p" }, { baseDelayMs: 1 })).toEqual({ from: "m2" });
    expect(f).toHaveBeenCalledTimes(3);
    delete process.env.GEMINI_FALLBACK_MODELS;
    resetExhausted();
  });
  it("a per-minute 429 is retried on the same model, not treated as a daily quota", async () => {
    env();
    process.env.GEMINI_FALLBACK_MODELS = "m2";
    resetExhausted();
    const perMinute = { error: { status: "RESOURCE_EXHAUSTED", message: "generate_content_free_tier_requests GenerateRequestsPerMinutePerProjectPerModel-FreeTier" } };
    const f = vi.fn().mockResolvedValueOnce(res(429, perMinute)).mockResolvedValueOnce(res(200, { from: "m" }));
    vi.stubGlobal("fetch", f);
    expect(await geminiRaw({ prompt: "p" }, { baseDelayMs: 1 })).toEqual({ from: "m" });
    expect(f.mock.calls.every((c) => String(c[0]).includes("/m:"))).toBe(true);
    delete process.env.GEMINI_FALLBACK_MODELS;
  });
  it("reads Google's suggested retry delay", () => {
    expect(retryAfterSeconds({ error: { message: "Please retry in 14.4s." } })).toBe(14.4);
    expect(retryAfterSeconds({ error: { details: [{ retryDelay: "7s" }] } })).toBe(7);
    expect(retryAfterSeconds({ error: { message: "nope" } })).toBeNull();
  });
  it("Budget caps calls", () => {
    const b = new Budget(2);
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
  });
});

describe("pool and rescoring", () => {
  it("pool never exceeds concurrency and stops when asked", async () => {
    let cur = 0, peak = 0, done = 0;
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 5)); cur--; done++; });
    expect(peak).toBe(3);
    expect(done).toBe(7);
    let n = 0;
    await pool([1, 2, 3, 4, 5], 1, async () => { n++; }, () => n >= 2);
    expect(n).toBe(2);
  });
  it("decideStored re-decides from saved marks with the new rubric", () => {
    const r = rubric();
    const marks = { criteria: { sector_fit: { mark: "yes", quote: "q" }, geography_fit: { mark: "yes", quote: "q" }, product_traction: { mark: "unclear", quote: null }, team_signal: { mark: "unclear", quote: null }, idea_clarity: { mark: "yes", quote: "q" } }, stage: { label: "seed", quote: "seed" }, published_at: "2026-10-12T00:00:00Z" };
    const now = new Date("2026-10-12T01:00:00Z");
    expect(decideStored(r, { marks, amount_usd: null }, now)).toMatchObject({ pass: false, score: 55 });
    r.passMark = 50;
    expect(decideStored(r, { marks, amount_usd: null }, now).pass).toBe(true);
  });
});
