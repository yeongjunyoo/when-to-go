// Pure analysis functions for the A3–A5 core screen. All of these operate
// ONLY on the rows belonging to a single selected attraction (A4/추천 rule)
// or on the whole collected window (A5/freshness rule) — never comparing
// one attraction's congestion figure against another's, and never
// re-deriving a sort/filter/top-N over the congestion value itself.
import type { AttractionRow } from "./proxyClient";

const HIGH_CONCENTRATION_THRESHOLD = 85; // inclusive: exactly 85 counts as high.
const EXPECTED_WINDOW_DAYS = 30; // documented upstream window; observed to shrink during upstream freezes.

export interface CalendarDay {
  baseYmd: string;
  /** null when missing or non-numeric — callers must render "정보 없음", never skip the day. */
  cnctrRate: number | null;
}

/**
 * A3: builds the full calendar for ONE attraction's own date column, sorted
 * chronologically. Missing/non-numeric values are kept as explicit null
 * entries — the day is never dropped from the calendar.
 */
export function buildCalendar(rows: AttractionRow[]): CalendarDay[] {
  return [...rows]
    .sort((a, b) => a.baseYmd.localeCompare(b.baseYmd))
    .map((row) => ({ baseYmd: row.baseYmd, cnctrRate: isValidRate(row.cnctrRate) ? row.cnctrRate : null }));
}

function isValidRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A4: "이 기간 내내 고집중" badge. min(dailyRates) >= 85, computed ONLY over
 * this attraction's own valid (non-missing, numeric) daily rates. Missing/
 * non-numeric values are excluded from the min, not treated as 0 or as a
 * disqualifier by themselves. If there are zero valid values at all, no
 * verdict can be reached (`null`) — never defaults to true or false.
 */
export function highConcentrationBadge(calendar: CalendarDay[]): boolean | null {
  const validRates = calendar.map((d) => d.cnctrRate).filter((v): v is number => v !== null);
  if (validRates.length === 0) return null;
  const min = Math.min(...validRates);
  return min >= HIGH_CONCENTRATION_THRESHOLD;
}

export interface RecommendedDay {
  baseYmd: string;
  cnctrRate: number;
}

/**
 * "추천 3일": from the same attraction's own date column, the 3 days with
 * the LOWEST congestion value (ties broken by earlier date first). Missing/
 * non-numeric days are excluded from candidacy. If the badge condition
 * (every valid day >= 85) holds, no recommendation is produced — the badge
 * alone is the answer, per contest rule.
 */
export function recommendedDays(calendar: CalendarDay[]): RecommendedDay[] {
  const valid = calendar.filter((d): d is CalendarDay & { cnctrRate: number } => d.cnctrRate !== null);
  if (valid.length === 0) return [];

  const badge = highConcentrationBadge(calendar);
  if (badge === true) return []; // badge alone is the answer; no separate recommendation.

  return [...valid]
    .sort((a, b) => (a.cnctrRate !== b.cnctrRate ? a.cnctrRate - b.cnctrRate : a.baseYmd.localeCompare(b.baseYmd)))
    .slice(0, 3)
    .map((d) => ({ baseYmd: d.baseYmd, cnctrRate: d.cnctrRate }));
}

export interface DateRange {
  min: string;
  max: string;
  windowLength: number;
}

/**
 * A5: computes the actual response date range AT RUNTIME from the data
 * itself. Never hardcoded — if upstream's window shrinks (observed: 30 ->
 * 21 days during an upstream update freeze), this reflects that instantly.
 */
export function computeDateRange(items: AttractionRow[]): DateRange | null {
  if (items.length === 0) return null;
  const dates = items.map((i) => i.baseYmd).filter((d) => /^\d{8}$/.test(d));
  if (dates.length === 0) return null;
  const sorted = [...new Set(dates)].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1], windowLength: sorted.length };
}

export interface FreshnessVerdict {
  stale: boolean;
  reason?: "short_window" | "min_date_in_past";
  windowLength: number;
  minDate: string;
  maxDate: string;
  collectedDay: string;
}

/**
 * 신선도 배지: fires when either
 *   (a) the observed window is shorter than the documented 30-day window, or
 *   (b) the response's min(baseYmd) is strictly before the day the data was
 *       collected (fetchedAt, in KST) — meaning the window did not actually
 *       start "today" as expected.
 * Both are computed from the live response, never assumed frozen at build time.
 */
export function computeFreshness(range: DateRange, fetchedAtMs: number): FreshnessVerdict {
  const collectedDay = kstDayString(fetchedAtMs);
  const shortWindow = range.windowLength < EXPECTED_WINDOW_DAYS;
  const minInPast = range.min < collectedDay;

  let reason: FreshnessVerdict["reason"];
  if (shortWindow) reason = "short_window";
  else if (minInPast) reason = "min_date_in_past";

  return {
    stale: shortWindow || minInPast,
    reason,
    windowLength: range.windowLength,
    minDate: range.min,
    maxDate: range.max,
    collectedDay,
  };
}

function kstDayString(epochMs: number): string {
  const kst = new Date(epochMs + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Formats an 8-digit baseYmd (YYYYMMDD) as YYYY-MM-DD for display. */
export function formatYmd(baseYmd: string): string {
  if (!/^\d{8}$/.test(baseYmd)) return baseYmd;
  return `${baseYmd.slice(0, 4)}-${baseYmd.slice(4, 6)}-${baseYmd.slice(6, 8)}`;
}
