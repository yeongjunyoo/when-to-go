// Runtime (not sampled) unlinked-rate dashboard. Computed from the actual
// resolution outcome of every attraction name in the currently queried
// sigungu — never a canned/precomputed estimate. Mirrors the M0 measurement
// definition exactly: (zero + multiple + address_mismatch) / attraction_count.
import { PoiIndex, resolveAttraction } from "./match";

export const UNLINKED_RATE_WARN_THRESHOLD = 25; // percent; M0's R3 trigger threshold.

export interface RejectionDashboard {
  total: number;
  zero: number;
  multiple: number;
  addressMismatch: number;
  singleMatch: number;
  unlinkedCount: number;
  unlinkedRatePercent: number;
  warn: boolean;
}

export function computeRejectionDashboard(attractionNames: string[], poiIndex: PoiIndex, sidoName: string, signguName: string): RejectionDashboard {
  let zero = 0;
  let multiple = 0;
  let addressMismatch = 0;
  let singleMatch = 0;

  for (const name of attractionNames) {
    const outcome = resolveAttraction(name, poiIndex, sidoName, signguName);
    if (outcome.kind === "zero_candidates") zero += 1;
    else if (outcome.kind === "multiple_candidates") multiple += 1;
    else if (outcome.kind === "address_mismatch") addressMismatch += 1;
    else singleMatch += 1;
  }

  const total = attractionNames.length;
  const unlinkedCount = zero + multiple + addressMismatch;
  const unlinkedRatePercent = total > 0 ? (unlinkedCount / total) * 100 : 0;

  return {
    total,
    zero,
    multiple,
    addressMismatch,
    singleMatch,
    unlinkedCount,
    unlinkedRatePercent,
    warn: unlinkedRatePercent > UNLINKED_RATE_WARN_THRESHOLD,
  };
}
