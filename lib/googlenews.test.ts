import { describe, expect, it } from "vitest";
import { isGoogleNewsLink, parseBatchExecute } from "./googlenews";

describe("Google News links", () => {
  it("recognises Google's redirect links only", () => {
    expect(isGoogleNewsLink("https://news.google.com/rss/articles/CBMiXYZ?oc=5")).toBe(true);
    expect(isGoogleNewsLink("https://news.google.com/rss/search?q=seed")).toBe(false);
    expect(isGoogleNewsLink("https://www.finsmes.com/2026/10/credfix.html")).toBe(false);
    expect(isGoogleNewsLink("not a url")).toBe(false);
  });
  it("reads the real address out of Google's answer", () => {
    const inner = JSON.stringify(["garturlresp", "https://www.finsmes.com/2026/10/credfix-raises.html", 1]);
    const text = `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", inner, null, null, null, "generic"]])}`;
    expect(parseBatchExecute(text)).toBe("https://www.finsmes.com/2026/10/credfix-raises.html");
  });
  it("returns null for anything else (the item is then skipped)", () => {
    expect(parseBatchExecute("")).toBeNull();
    expect(parseBatchExecute("garbage\n\nnot json")).toBeNull();
    const back = JSON.stringify(["garturlresp", "https://news.google.com/articles/x", 1]);
    expect(parseBatchExecute(`x\n\n${JSON.stringify([["wrb.fr", "Fbv4je", back]])}`)).toBeNull();
  });
});
