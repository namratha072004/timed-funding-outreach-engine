/**
 * Google News search results (news.google.com/rss/search?q=...) link to a Google redirect page, not the publisher.
 * This turns such a link into the real article address, so the article can be read, de-duplicated against the
 * other feeds, and judged like any other. Returns null when Google does not give an address (the item is skipped).
 */
export const isGoogleNewsLink = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.hostname === "news.google.com" && /\/articles\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Pure: pulls the address out of Google's batchexecute answer. */
export function parseBatchExecute(text: string): string | null {
  try {
    const body = text.split("\n\n")[1];
    if (!body) return null;
    const outer = JSON.parse(body);
    const inner = JSON.parse(outer[0][2]);
    const url = inner?.[1];
    return typeof url === "string" && /^https?:\/\//.test(url) && !/news\.google\.com/.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  try {
    const id = new URL(url).pathname.split("/").pop()!;
    const page = await fetch(`https://news.google.com/articles/${id}?hl=en-US&gl=US&ceid=US:en`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (!page.ok) return null;
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const payload = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
    const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
      body: new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", payload]]]) }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    return parseBatchExecute(await r.text());
  } catch {
    return null;
  }
}
