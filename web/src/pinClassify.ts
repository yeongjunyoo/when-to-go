// Map-pin color classification (B4).
//
// ★ HARD CONTRACT: pin color is NEVER derived from the raw congestion
// value directly, and NEVER compares one attraction's value against
// another's. The concentration figure is a per-signgu relative
// normalization — cross-attraction comparison is data-structurally
// meaningless (see web/src/sortAttractions.ts, tests/no-rate-ranking.test.ts).
//
// Instead, each attraction is classified using its OWN distribution only:
// a day's percentile RANK within that same attraction's own valid daily
// values (nearest-rank / cumulative-frequency method), bucketed into 3
// tiers. Because the classification input for attraction A never includes
// any value from attraction B, changing B's values can NEVER change A's
// pin color — this is a structural guarantee, verified by
// tests/pin-classify.test.ts "관광지 독립성" tests.
import type { CalendarDay } from "./attractionAnalysis";
import { highConcentrationBadge } from "./attractionAnalysis";

export type PinTier = "low" | "mid" | "high" | "neutral";

export interface PinClassification {
  tier: PinTier;
  /** true when the "이 기간 내내 고집중" badge (min>=85) forced tier="high" regardless of that day's percentile. */
  badgeOverride: boolean;
  /** true when max-min < SPREAD_GUARD_THRESHOLD forced tier="neutral" (no meaningful variation to color by). */
  spreadGuardApplied: boolean;
  /** the day's percentile rank within the attraction's own distribution, 0-100. null if no valid value for that day. */
  percentileRank: number | null;
  targetDate: string | null;
}

export const SPREAD_GUARD_THRESHOLD = 10; // percentage points; below this, coloring implies variation that doesn't exist.
const LOW_MID_BOUNDARY = 100 / 3; // 33.33..
const MID_HIGH_BOUNDARY = 200 / 3; // 66.66..

/**
 * Nearest-rank / cumulative-frequency percentile of `value` within
 * `sortedAscending` (its own attraction's valid values only):
 * percentile = (count of values <= v) / N * 100.
 */
export function percentileRankOf(value: number, sortedAscending: number[]): number {
  if (sortedAscending.length === 0) return NaN;
  let count = 0;
  for (const v of sortedAscending) {
    if (v <= value) count += 1;
  }
  return (count / sortedAscending.length) * 100;
}

function tierFromPercentile(p: number): PinTier {
  if (p <= LOW_MID_BOUNDARY) return "low";
  if (p <= MID_HIGH_BOUNDARY) return "mid";
  return "high";
}

/**
 * Classifies the pin color for ONE attraction on `targetDate` (defaults to
 * the most recent date in its own calendar if omitted). Priority:
 *   1. badge override (min>=85 across the WHOLE window) -> always "high"
 *   2. spread guard (max-min < 10 points across the WHOLE window) -> "neutral"
 *   3. normal 3-tier nearest-rank percentile of targetDate's value within
 *      the attraction's own distribution
 * Returns tier="neutral", percentileRank=null when there is no valid data
 * at all (never fabricates a color).
 */
export function classifyPin(calendar: CalendarDay[], targetDate?: string): PinClassification {
  const validDays = calendar.filter((d): d is CalendarDay & { cnctrRate: number } => d.cnctrRate !== null);
  if (validDays.length === 0) {
    return { tier: "neutral", badgeOverride: false, spreadGuardApplied: false, percentileRank: null, targetDate: targetDate ?? null };
  }

  const resolvedTargetDate = targetDate ?? validDays[validDays.length - 1].baseYmd;
  const targetDay = validDays.find((d) => d.baseYmd === resolvedTargetDate);

  const badge = highConcentrationBadge(calendar);
  if (badge === true) {
    return { tier: "high", badgeOverride: true, spreadGuardApplied: false, percentileRank: targetDay ? 100 : null, targetDate: resolvedTargetDate };
  }

  const values = validDays.map((d) => d.cnctrRate);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min < SPREAD_GUARD_THRESHOLD) {
    return { tier: "neutral", badgeOverride: false, spreadGuardApplied: true, percentileRank: null, targetDate: resolvedTargetDate };
  }

  if (!targetDay) {
    return { tier: "neutral", badgeOverride: false, spreadGuardApplied: false, percentileRank: null, targetDate: resolvedTargetDate };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = percentileRankOf(targetDay.cnctrRate, sorted);
  return { tier: tierFromPercentile(percentile), badgeOverride: false, spreadGuardApplied: false, percentileRank: percentile, targetDate: resolvedTargetDate };
}

export const PIN_TIER_COLORS: Record<PinTier, string> = {
  low: "#2563eb", // blue — this attraction's relatively quieter days
  mid: "#f59e0b", // amber
  high: "#dc2626", // red — includes badge-override "이 기간 내내 고집중" attractions
  neutral: "#9ca3af", // gray — spread guard or no data; never implies "quiet" or "crowded"
};
