const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compile funding keywords into one whole-word, case-insensitive matcher ("mn" must not match "mnemonic"). */
export function keywordMatcher(keywords: string[]): (text: string) => boolean {
  const parts = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => esc(k).replace(/\s+/g, "\\s+").replace(/\\-/g, "[-\\u2010-\\u2013 ]?"));
  if (!parts.length) return () => true; // empty list = no keyword restriction
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})(?![\\p{L}\\p{N}])`, "iu");
  return (text) => re.test(text);
}

export type FilterVerdict = { keep: true } | { keep: false; reason: string };

/** Code-only pre-filter, run before any AI. Keyword check first, then age. Unknown date is kept (the recency gate rejects it later with an audit trail). */
export function filterItem(
  item: { title: string; summary?: string; publishedAt: Date | null },
  opts: { match: (t: string) => boolean; lookbackHours: number; now: Date; checkKeywords: boolean },
): FilterVerdict {
  if (opts.checkKeywords && !opts.match(`${item.title}\n${item.summary ?? ""}`)) return { keep: false, reason: "no funding keyword" };
  if (item.publishedAt && opts.now.getTime() - item.publishedAt.getTime() > opts.lookbackHours * 3_600_000) {
    return { keep: false, reason: `older than ${opts.lookbackHours}h` };
  }
  return { keep: true };
}
