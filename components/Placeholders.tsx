import type { ReactNode } from "react";

/** Wraps [PLACEHOLDER] tokens in a pale yellow highlight so Rohit sees what to fill. */
export function WithPlaceholders({ text }: { text: string }): ReactNode {
  return text.split(/(\[[A-Z][A-Z ]+\])/g).map((part, i) => (/^\[[A-Z][A-Z ]+\]$/.test(part) ? <mark key={i} className="ph">{part}</mark> : part));
}
