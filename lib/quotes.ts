import type { MarkedCriterion } from "./types";

/** Letters and digits only, lowercase: curly vs straight quotes, dash types, spacing and punctuation cannot cause a false miss. */
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * True if the quote appears in the source text (case, spacing, punctuation and quote/dash styles ignored).
 * A quote written with an ellipsis ("... ") counts if every piece of 12+ characters appears in the text.
 */
export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const hay = norm(text);
  const pieces = quote.split(/\.{3}|\u2026/).map(norm).filter(Boolean);
  if (!pieces.length) return false;
  if (pieces.length === 1) return pieces[0]!.length > 0 && hay.includes(pieces[0]!);
  const big = pieces.filter((p) => p.length >= 12);
  return big.length > 0 && big.every((p) => hay.includes(p));
}

/**
 * A "yes" or "partial" must carry a quote that really appears in the source.
 * Otherwise it is downgraded to "unclear" (and reported so the caller can log it).
 */
export function verifyMarks(
  marks: Record<string, MarkedCriterion>,
  sourceText: string,
): { marks: Record<string, MarkedCriterion>; downgraded: string[] } {
  const out: Record<string, MarkedCriterion> = {};
  const downgraded: string[] = [];
  for (const [k, m] of Object.entries(marks)) {
    if ((m.mark === "yes" || m.mark === "partial") && !quoteInText(m.quote, sourceText)) {
      out[k] = { mark: "unclear", quote: m.quote };
      downgraded.push(k);
    } else out[k] = m;
  }
  return { marks: out, downgraded };
}
