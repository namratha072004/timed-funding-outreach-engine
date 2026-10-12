const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|source$|cmpid$|ocid$)/i;

/** Canonical URL: https/http only, lowercase host, no www, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if (u.port === "443" || u.port === "80") u.port = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  const s = u.toString();
  return u.pathname === "/" && !u.search ? s.replace(/\/$/, "") : s;
}

const LEGAL = /\b(pvt|private|ltd|limited|inc|llc|llp|technologies|technology|labs|corp|co)\b/g;

/** Cleaned startup name used for dedupe: lowercase, no punctuation, no legal suffixes. */
export function nameKey(name: string): string {
  const k = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
  // if stripping suffixes removed everything ("Labs"), fall back to the plain cleaned name
  return k || name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

const NOT_A_STARTUP_SITE = /(^|\.)(linkedin|twitter|x|facebook|instagram|youtube|youtu|medium|crunchbase|tracxn|wikipedia|github|google|apple|play\.google|t|bit|goo|lnkd|whatsapp|pinterest|reddit|substack)\.(com|be|me|ly|gl|in|co|org)$/;
export function isCandidateWebsite(domain: string | null, publisherDomain?: string | null): boolean {
  if (!domain) return false;
  if (publisherDomain && (domain === publisherDomain || domain.endsWith(`.${publisherDomain}`))) return false;
  return !NOT_A_STARTUP_SITE.test(domain);
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const safeChr = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ");

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Main article body if the page has an <article>/<main>, otherwise the whole page. */
export function articleText(html: string): string {
  const pick = (re: RegExp) => html.match(re)?.[1];
  const scoped = pick(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? pick(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const title = decodeEntities(pick(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? "").trim();
  if (scoped && htmlToText(scoped).length > 600) return htmlToText(scoped);
  // No clear article container: keep paragraph-like lines only, so menus and link lists cannot push the story out of the size cap
  const lines = htmlToText(html).split("\n").map((l) => l.trim()).filter((l) => l.length >= 60 || /[.!?]["')]?$/.test(l) && l.length >= 25);
  return [title, ...lines].filter(Boolean).join("\n");
}

export function metaContent(html: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v) return decodeEntities(v).trim();
  }
  return null;
}

export function publishedFromHtml(html: string): Date | null {
  const v = metaContent(html, ["article:published_time", "og:article:published_time", "datePublished", "pubdate", "date"]) ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function hrefs(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]!), base);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.origin + (u.pathname === "/" ? "" : u.pathname));
    } catch {
      /* ignore bad hrefs */
    }
  }
  return [...out];
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const BAD_TLD = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i;
/** Emails on the given domain (or its subdomains), from mailto: links and plain text. Deduped, lowercase. */
export function emailsOnDomain(html: string, domain: string): string[] {
  const found = new Set<string>();
  const hay = decodeEntities(html).replace(/\[at\]|\(at\)/gi, "@");
  for (const m of hay.matchAll(EMAIL)) {
    const e = m[0].toLowerCase().replace(/^[.%+-]+/, "");
    if (BAD_TLD.test(e)) continue;
    const d = e.split("@")[1]!;
    if (d === domain || d.endsWith(`.${domain}`)) found.add(e);
  }
  return [...found];
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Pull a probable startup name from a headline: "Zaperon raises $2M in seed round" -> "Zaperon". */
const VERBS = "raises|raised|bags|bagged|secures|secured|lands|landed|closes|closed|gets|receives|received|snags|nets|picks up|mops up|pockets|garners|scores|announces|announced|attracts|gains";
export function guessNameFromTitle(title: string): string | null {
  const m = title.match(new RegExp(`^(.{2,60}?)\\s+(?:${VERBS})\\b`, "i"));
  if (!m) return null;
  const n = m[1]!.replace(/^[\W_]+|[\W_]+$/g, "");
  return n.length >= 2 ? n : null;
}

/**
 * Outbound links that could be the startup's own website: taken from the article body (not menus), one per domain,
 * excluding the publisher itself and social/aggregator sites.
 */
export function externalLinks(html: string, base: string, publisherDomains: string[] = []): string[] {
  const scoped = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const self = domainOf(base);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of hrefs(scoped, base)) {
    const d = domainOf(l);
    if (!d || seen.has(d) || d === self || publisherDomains.some((p) => d === p || d.endsWith(`.${p}`)) || !isCandidateWebsite(d, self)) continue;
    seen.add(d);
    out.push(l);
    if (out.length >= 25) break;
  }
  return out;
}
