import { XMLParser } from "fast-xml-parser";
import { safeFetchText } from "./ssrf";
import { canonicalUrl, htmlToText } from "./text";

export interface FeedRow {
  id: number;
  name: string;
  url: string;
  kind: "rss" | "atom" | "sitemap";
}

export interface FeedItem {
  url: string; // canonical
  title: string;
  source: string;
  publishedAt: Date | null;
  summary: string;
  content: string; // full text from the feed if present (content:encoded), else ""
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true, trimValues: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const date = (v: any): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Pure: XML text -> items. Handles RSS 2.0, Atom and (news) sitemaps. */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const doc = parser.parse(xml);
  const out: FeedItem[] = [];
  const push = (link: string, title: string, published: Date | null, summary: string, content: string) => {
    const url = canonicalUrl(link);
    if (url && title) out.push({ url, title: htmlToText(title), source, publishedAt: published, summary: htmlToText(summary).slice(0, 1500), content: content ? htmlToText(content).slice(0, 15000) : "" });
  };
  for (const it of arr(doc?.rss?.channel?.item)) {
    push(str(it.link) || str(it.guid), str(it.title), date(it.pubDate) ?? date(it["dc:date"]), str(it.description), str(it["content:encoded"]));
  }
  for (const e of arr(doc?.feed?.entry)) {
    const links = arr(e.link) as any[];
    const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    push(str(alt?.["@_href"]), str(e.title), date(e.published) ?? date(e.updated), str(e.summary), str(e.content));
  }
  for (const u of arr(doc?.urlset?.url)) {
    const news = u["news:news"];
    const title = str(news?.["news:title"]) || str(u.loc).split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || "";
    push(str(u.loc), title, date(news?.["news:publication_date"]) ?? date(u.lastmod), "", "");
  }
  return out;
}

export async function fetchFeed(feed: FeedRow): Promise<FeedItem[]> {
  const r = await safeFetchText(feed.url, { maxBytes: 6_000_000, timeoutMs: 15_000, accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.5" });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
  const items = parseFeed(r.text, feed.name);
  if (!items.length) throw new Error("no items found in feed");
  return items;
}
