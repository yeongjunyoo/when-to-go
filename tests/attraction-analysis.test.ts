import { describe, it, expect } from "vitest";
import {
  buildCalendar,
  highConcentrationBadge,
  recommendedDays,
  computeDateRange,
  computeFreshness,
  formatYmd,
  CalendarDay,
} from "../web/src/attractionAnalysis";
import type { AttractionRow } from "../web/src/proxyClient";

function row(baseYmd: string, cnctrRate: number | null): AttractionRow {
  // AttractionRow.cnctrRate is typed number, but upstream data can hand us
  // NaN/non-numeric in practice — cast to simulate that at the boundary.
  return { baseYmd, tAtsNm: "테스트관광지", cnctrRate: cnctrRate as number };
}

describe("A3: buildCalendar — never skips a day", () => {
  it("renders every date, including missing/non-numeric ones as null (not dropped)", () => {
    const rows = [row("20260828", 50), row("20260829", NaN), row("20260830", 60)];
    const calendar = buildCalendar(rows);
    expect(calendar).toHaveLength(3);
    expect(calendar.map((d) => d.baseYmd)).toEqual(["20260828", "20260829", "20260830"]);
    expect(calendar[1].cnctrRate).toBeNull();
  });

  it("sorts chronologically regardless of input order", () => {
    const rows = [row("20260830", 60), row("20260828", 50), row("20260829", 55)];
    const calendar = buildCalendar(rows);
    expect(calendar.map((d) => d.baseYmd)).toEqual(["20260828", "20260829", "20260830"]);
  });
});

describe("A4: high-concentration badge — boundary and missing-data behavior", () => {
  it("exactly 85 -> badge ON (inclusive comparison)", () => {
    const calendar: CalendarDay[] = [{ baseYmd: "20260828", cnctrRate: 85 }, { baseYmd: "20260829", cnctrRate: 90 }];
    expect(highConcentrationBadge(calendar)).toBe(true);
  });

  it("84.99 -> badge OFF", () => {
    const calendar: CalendarDay[] = [{ baseYmd: "20260828", cnctrRate: 84.99 }, { baseYmd: "20260829", cnctrRate: 99 }];
    expect(highConcentrationBadge(calendar)).toBe(false);
  });

  it("missing/non-numeric values mixed in are excluded from the min, not counted as failures", () => {
    const calendar: CalendarDay[] = [
      { baseYmd: "20260828", cnctrRate: 90 },
      { baseYmd: "20260829", cnctrRate: null }, // missing — excluded
      { baseYmd: "20260830", cnctrRate: 88 },
    ];
    // min of valid values (90, 88) = 88 >= 85 -> ON, missing day does not disqualify.
    expect(highConcentrationBadge(calendar)).toBe(true);
  });

  it("all values missing -> verdict cannot be reached (null), not defaulted to true or false", () => {
    const calendar: CalendarDay[] = [{ baseYmd: "20260828", cnctrRate: null }, { baseYmd: "20260829", cnctrRate: null }];
    expect(highConcentrationBadge(calendar)).toBeNull();
  });
});

describe("recommended 3 days", () => {
  it("selects the 3 lowest days from the attraction's own column", () => {
    const calendar: CalendarDay[] = [
      { baseYmd: "20260828", cnctrRate: 50 },
      { baseYmd: "20260829", cnctrRate: 10 },
      { baseYmd: "20260830", cnctrRate: 30 },
      { baseYmd: "20260831", cnctrRate: 20 },
      { baseYmd: "20260901", cnctrRate: 40 },
    ];
    const rec = recommendedDays(calendar);
    expect(rec.map((r) => r.baseYmd)).toEqual(["20260829", "20260831", "20260830"]); // 10, 20, 30
  });

  it("ties broken by earlier date first", () => {
    const calendar: CalendarDay[] = [
      { baseYmd: "20260830", cnctrRate: 20 },
      { baseYmd: "20260828", cnctrRate: 20 },
      { baseYmd: "20260829", cnctrRate: 20 },
      { baseYmd: "20260831", cnctrRate: 50 },
    ];
    const rec = recommendedDays(calendar);
    expect(rec.map((r) => r.baseYmd)).toEqual(["20260828", "20260829", "20260830"]);
  });

  it("excludes missing/non-numeric days from candidacy", () => {
    const calendar: CalendarDay[] = [
      { baseYmd: "20260828", cnctrRate: null },
      { baseYmd: "20260829", cnctrRate: 10 },
      { baseYmd: "20260830", cnctrRate: 20 },
    ];
    const rec = recommendedDays(calendar);
    expect(rec.map((r) => r.baseYmd)).toEqual(["20260829", "20260830"]);
  });

  it("when every valid day is >= 85, no recommendation is produced (badge alone is the answer)", () => {
    const calendar: CalendarDay[] = [
      { baseYmd: "20260828", cnctrRate: 85 },
      { baseYmd: "20260829", cnctrRate: 90 },
      { baseYmd: "20260830", cnctrRate: 99 },
    ];
    expect(highConcentrationBadge(calendar)).toBe(true);
    expect(recommendedDays(calendar)).toEqual([]);
  });

  it("all missing -> no recommendation and no badge verdict", () => {
    const calendar: CalendarDay[] = [{ baseYmd: "20260828", cnctrRate: null }];
    expect(recommendedDays(calendar)).toEqual([]);
    expect(highConcentrationBadge(calendar)).toBeNull();
  });
});

describe("A5: runtime date range — never hardcoded", () => {
  it("computes min/max/windowLength from the actual rows, not a constant", () => {
    const rows = [row("20260828", 1), row("20260829", 2), row("20260830", 3)];
    const range = computeDateRange(rows);
    expect(range).toEqual({ min: "20260828", max: "20260830", windowLength: 3 });
  });

  it("reflects a shorter real window (e.g. an observed 21-day freeze) rather than assuming 30", () => {
    // Reproduces the documented 2026-08-24 snapshot: window shrank to 21 days
    // because upstream froze its max date at 20260913 for 9 days.
    const rows: AttractionRow[] = [];
    let d = new Date(Date.UTC(2026, 7, 24)); // 2026-08-24
    for (let i = 0; i < 21; i++) {
      const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
      rows.push(row(ymd, 50));
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
    const range = computeDateRange(rows);
    expect(range?.windowLength).toBe(21);
    expect(range?.min).toBe("20260824");
    expect(range?.max).toBe("20260913");
  });

  it("returns null for an empty item set instead of a fabricated range", () => {
    expect(computeDateRange([])).toBeNull();
  });
});

describe("freshness badge — reproduces the documented 2026-08 upstream freeze", () => {
  const collectedAtAug28 = Date.UTC(2026, 7, 28, 0, 20, 1); // 2026-08-28T09:20:01+09:00 roughly

  it("normal 30-day window -> freshness badge OFF", () => {
    const range = { min: "20260828", max: "20260926", windowLength: 30 };
    const verdict = computeFreshness(range, collectedAtAug28);
    expect(verdict.stale).toBe(false);
  });

  it("21-day window (the real observed 2026-08-24 freeze snapshot) -> badge ON", () => {
    // Exact reproduction: min=20260824, max=20260913 (frozen), distinct_days=21.
    const range = { min: "20260824", max: "20260913", windowLength: 21 };
    const collectedAug24 = Date.UTC(2026, 7, 24, 0, 20, 1);
    const verdict = computeFreshness(range, collectedAug24);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("short_window");
  });

  it("16-day window -> badge ON", () => {
    const range = { min: "20260829", max: "20260913", windowLength: 16 };
    const verdict = computeFreshness(range, collectedAtAug28);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("short_window");
  });

  it("min(baseYmd) older than collection day -> badge ON even if window length is 30", () => {
    // Window length is technically 30 but the earliest date is from before
    // today's collection — data did not actually roll forward.
    const range = { min: "20260820", max: "20260918", windowLength: 30 };
    const verdict = computeFreshness(range, collectedAtAug28);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("min_date_in_past");
  });

  it("collectedDay is derived from fetchedAt in KST, not hardcoded", () => {
    const range = { min: "20260828", max: "20260926", windowLength: 30 };
    const verdict = computeFreshness(range, collectedAtAug28);
    expect(verdict.collectedDay).toBe("20260828");
  });
});

describe("formatYmd", () => {
  it("formats an 8-digit baseYmd as YYYY-MM-DD", () => {
    expect(formatYmd("20260828")).toBe("2026-08-28");
  });

  it("passes through malformed input unchanged rather than throwing", () => {
    expect(formatYmd("bad")).toBe("bad");
  });
});
