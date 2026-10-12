import { safeFetchText } from "./ssrf";
import { articleText, domainOf, emailsOnDomain, isCandidateWebsite } from "./text";

export interface Contact {
  email: string;
  name: string | null;
  role: string | null;
  source: "hunter" | "contact_page";
  verified: boolean; // true only for Hunter "valid"
}

/** The website Gemini returned counts only if its domain really appears in the source text or the article's links. */
export function verifyWebsite(website: string | null, sourceText: string, links: string[], publisherDomains: string[]): { domain: string; url: string } | null {
  const domain = domainOf(website);
  if (!domain) return null;
  if (publisherDomains.some((p) => !isCandidateWebsite(domain, p))) return null;
  if (!isCandidateWebsite(domain)) return null;
  const inText = sourceText.toLowerCase().includes(domain);
  const inLinks = links.some((l) => domainOf(l) === domain);
  return inText || inLinks ? { domain, url: `https://${domain}` } : null;
}

/** Candidate domains for a startup name: "Sorry Sugar" -> sorrysugar.com/.in/.ai/.io/.co */
export function domainCandidates(name: string): string[] {
  const slug = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug.length < 3) return [];
  return ["com", "in", "ai", "io", "co"].map((t) => `${slug}.${t}`);
}

/**
 * Fallback when the article names no website: try name-based domains and accept one only if its homepage (title, headings
 * or text) contains the startup's name. The result is evidence-checked but still a guess, so it is used for the contact-page
 * route only (To stays blank) and never for Hunter.
 */
/** Startup name without generic trailing words: "TailBlaze Longevity" -> "tailblaze", "CurvetAI" -> "curvet". At least 5 characters, else the full name. */
export function coreKey(name: string): string {
  const full = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const core = full.replace(/(longevity|technologies|technology|labs|global|health|ai|app|hq|tech|io)$/g, "");
  return core.length >= 5 ? core : full;
}

/** True if the site at `domain` is plausibly the startup: its title or text contains the startup's name (or its core name). */
export async function homepageMatches(domain: string, name: string): Promise<string | null> {
  const key = coreKey(name);
  try {
    const r = await safeFetchText(`https://${domain}`, { maxBytes: 400_000, timeoutMs: 6000, maxRedirects: 2 });
    if (r.status >= 400) return null;
    const finalHost = domainOf(r.finalUrl);
    const text = articleText(r.text).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const title = (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return finalHost && (title.includes(key) || text.includes(key)) ? finalHost : null;
  } catch {
    return null;
  }
}

export async function guessWebsite(name: string): Promise<string | null> {
  for (const d of domainCandidates(name)) {
    const hit = await homepageMatches(d, name);
    if (hit) return hit;
  }
  return null;
}

/** Domains mentioned in a Gemini search answer (plain text and grounding source titles). Pure. */
export function domainsFromAnswer(text: string, chunkTitles: string[] = []): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const d = domainOf(s.trim().replace(/[),.;:]+$/, ""));
    if (d && isCandidateWebsite(d) && !out.includes(d)) out.push(d);
  };
  for (const m of text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi)) add(m[1]!);
  for (const t of chunkTitles) if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t.trim())) add(t);
  return out.slice(0, 5);
}

/**
 * Web search fallback (Gemini + Google Search grounding, optional). Gemini only proposes domains; each one must
 * pass the same homepage check as a name guess, so an invented answer is rejected.
 */
export async function findWebsiteViaSearch(name: string, hint: string, ask: (p: string) => Promise<{ text: string; titles: string[] }>): Promise<string | null> {
  const { text, titles } = await ask(`What is the official website domain of the startup "${name}"${hint ? ` (${hint})` : ""}? Reply with only the domain, or "unknown" if you are not sure.`);
  for (const d of domainsFromAnswer(text, titles)) {
    const hit = await homepageMatches(d, name);
    if (hit) return hit;
  }
  return null;
}

// ---- robots.txt (minimal: User-agent "*" and our own agent, Disallow/Allow longest match) ----
export function robotsAllows(robotsTxt: string, path: string, agent = "outreachengine"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; p: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!.trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if ((k === "allow" || k === "disallow") && cur) {
      cur.rules.push({ allow: k === "allow", p: v });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const use = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of use) {
    for (const r of g.rules) {
      if (!r.p) continue; // empty Disallow = allow all
      const re = new RegExp("^" + r.p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (re.test(path) && (!best || r.p.length >= best.len)) best = { allow: r.allow, len: r.p.length };
    }
  }
  return best ? best.allow : true;
}

async function allowedByRobots(origin: string, path: string): Promise<boolean> {
  try {
    const r = await safeFetchText(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 6000 });
    if (r.status >= 400) return true; // no robots file = no restriction
    return robotsAllows(r.text, path);
  } catch {
    return true; // unreachable robots.txt; the page fetch will fail on its own if the site is down
  }
}

export interface SiteInfo {
  homepageText: string;
  contacts: Contact[]; // contact-page emails, unverified
  notes: string[];
}

/** Homepage text for personalisation plus emails on the startup's own domain from its contact pages. Honours robots.txt. */
export async function readSite(domain: string): Promise<SiteInfo> {
  const origin = `https://${domain}`;
  const notes: string[] = [];
  let homepageText = "";
  const emails = new Set<string>();
  for (const path of ["/", "/contact", "/contact-us", "/about"]) {
    if (!(await allowedByRobots(origin, path))) {
      notes.push(`robots.txt disallows ${path}`);
      continue;
    }
    try {
      const r = await safeFetchText(origin + path, { maxBytes: 800_000, timeoutMs: 8000 });
      if (r.status >= 400) continue;
      if (path === "/") homepageText = articleText(r.text).slice(0, 6000);
      for (const e of emailsOnDomain(r.text, domain)) emails.add(e);
    } catch (e) {
      notes.push(`${path}: ${(e as Error).message}`);
      if (path === "/") break; // site unreachable, do not hammer the other paths
    }
  }
  return { homepageText, contacts: [...emails].slice(0, 6).map((email) => ({ email, name: null, role: null, source: "contact_page", verified: false })), notes };
}

// ---- Hunter ----
export async function hunterAccount(): Promise<{ used: number; available: number } | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.hunter.io/v2/account", { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const s = (await r.json())?.data?.requests?.searches;
  return typeof s?.used === "number" && typeof s?.available === "number" ? { used: s.used, available: s.available } : null;
}

const alnum = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Hunter's organization must be the startup (used when the domain was only guessed from the name). */
export function orgMatches(org: string | null | undefined, startupName: string): boolean {
  const o = alnum(org ?? "");
  const n = alnum(startupName);
  return o.length >= 3 && n.length >= 3 && (o.includes(n) || n.includes(o));
}

async function hunterVerify(email: string): Promise<boolean> {
  const r = await fetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}`, { headers: { "X-API-KEY": process.env.HUNTER_API_KEY! }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return false;
  return (await r.json())?.data?.status === "valid";
}

/**
 * Hunter domain search, then Hunter's own verifier on the best candidates. Only addresses Hunter reports as "valid" are returned.
 * `expectName`: when the domain was guessed, Hunter's organization must match this name or nothing is returned.
 */
export async function hunterVerified(domain: string, expectName?: string): Promise<Contact[]> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error("HUNTER_API_KEY not set");
  const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10`, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Hunter HTTP ${r.status}`);
  const data = (await r.json())?.data;
  if (expectName && !orgMatches(data?.organization, expectName)) return [];
  const emails: any[] = (data?.emails ?? []).filter((e: any) => e?.value).sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const toContact = (e: any): Contact => ({ email: String(e.value).toLowerCase(), name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null, role: e.position ?? null, source: "hunter", verified: true });
  const out: Contact[] = emails.filter((e) => e.verification?.status === "valid").map(toContact);
  for (const e of emails.filter((x) => x.verification?.status !== "valid" && (x.confidence ?? 0) >= 50).slice(0, 3)) {
    if (out.length >= 2) break;
    if (await hunterVerify(e.value).catch(() => false)) out.push(toContact(e));
  }
  return out.slice(0, 3);
}
