import { describe, expect, it } from "vitest";
import { articleOutcome, plainReason, primaryArticles } from "./outcomes";
import { ago, greeting, hoursLabel, median } from "./time";

const names = { sector_fit: "Sector fit with the accelerator's thesis" };
const art = (o: Partial<{ id: number; status: string; startup_id: number | null; error: string | null }> = {}) => ({ id: 1, status: "processed", startup_id: null, error: null, ...o });

describe("Sources outcome mapping", () => {
  it("error and not-yet-read come from articles.status", () => {
    expect(articleOutcome(art({ status: "error", error: "gemini: HTTP 503" }), undefined, true, null).outcome).toBe("error");
    expect(articleOutcome(art({ status: "new" }), undefined, true, null).outcome).toBe("waiting");
  });
  it("a read article with no linked startup is not funding news", () => {
    expect(articleOutcome(art(), undefined, true, null).outcome).toBe("filtered");
  });
  it("an article that is not the startup's first is merged", () => {
    const o = articleOutcome(art({ id: 2, startup_id: 9 }), { status: "drafted", reject_reason: null }, false, "Inc42");
    expect(o).toEqual({ outcome: "merged", detail: "Same startup as the Inc42 article" });
  });
  it("the first article follows the startup: drafted, rejected, or too old", () => {
    expect(articleOutcome(art({ startup_id: 9 }), { status: "drafted", reject_reason: null }, true, null).outcome).toBe("drafted");
    expect(articleOutcome(art({ startup_id: 9 }), { status: "queued_overrule", reject_reason: null }, true, null).detail).toBe("Draft queued");
    expect(articleOutcome(art({ startup_id: 9 }), { status: "rejected", reject_reason: "sector_fit = no" }, true, null, names)).toEqual({ outcome: "rejected", detail: "Sector fit with the accelerator's thesis: no" });
    expect(articleOutcome(art({ startup_id: 9 }), { status: "rejected", reject_reason: "older than 24h" }, true, null).outcome).toBe("old");
    expect(articleOutcome(art({ startup_id: 9 }), { status: "rejected", reject_reason: "date unknown" }, true, null).outcome).toBe("old");
  });
  it("picks each startup's first article by publish time, unknown dates last, then id", () => {
    const m = primaryArticles([
      { id: 5, startup_id: 1, published_at: "2026-10-12T10:00:00Z" },
      { id: 3, startup_id: 1, published_at: "2026-10-12T08:00:00Z" },
      { id: 1, startup_id: 1, published_at: null },
      { id: 7, startup_id: 2, published_at: null },
      { id: 6, startup_id: 2, published_at: null },
      { id: 9, startup_id: null, published_at: "2026-10-12T08:00:00Z" },
    ]);
    expect(m.get(1)!.id).toBe(3);
    expect(m.get(2)!.id).toBe(6);
    expect(m.size).toBe(2);
  });
});

describe("plain reasons", () => {
  it("rewords the reasons that code writes", () => {
    expect(plainReason("older than 24h")).toBe("Older than 24 hours");
    expect(plainReason("date unknown")).toBe("Publication date not found");
    expect(plainReason("stage: other")).toBe('Stage is "other", not one you back');
    expect(plainReason("score 55 below pass mark 65")).toBe("Score 55 is below the pass mark of 65");
    expect(plainReason("round size above 5000000 USD")).toBe("Round is larger than $5,000,000");
    expect(plainReason("geography_fit = no")).toBe("geography fit: no");
    expect(plainReason("something new")).toBe("something new");
    expect(plainReason(null)).toBe("No reason saved");
  });
});

describe("time helpers", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  it("ago", () => {
    expect(ago("2026-10-12T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-12T11:15:00Z", now)).toBe("45 min ago");
    expect(ago("2026-10-12T06:00:00Z", now)).toBe("6 h ago");
    expect(ago("2026-10-09T12:00:00Z", now)).toBe("3 days ago");
    expect(ago(null, now)).toBe("unknown");
  });
  it("greeting follows Indian time", () => {
    expect(greeting(new Date("2026-10-12T03:30:00Z"))).toBe("Good morning"); // 09:00 IST
    expect(greeting(new Date("2026-10-12T08:30:00Z"))).toBe("Good afternoon"); // 14:00 IST
    expect(greeting(new Date("2026-10-12T14:00:00Z"))).toBe("Good evening"); // 19:30 IST
  });
  it("median and hours label", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(hoursLabel(0.4)).toBe("24 min");
    expect(hoursLabel(4.26)).toBe("4.3 h");
    expect(hoursLabel(30)).toBe("30 h");
    expect(hoursLabel(120)).toBe("5 days");
    expect(hoursLabel(null)).toBe("-");
  });
});
