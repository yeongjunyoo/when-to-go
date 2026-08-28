// Attraction list ordering.
//
// HARD CONTEST RULE: the per-attraction congestion figure is a per-signgu
// relative normalization — it is NOT comparable across different
// attractions in a data-structural sense. Therefore this codebase must
// never contain a congestion-value-based sort, filter, or top-N cut
// function. The ONLY supported ordering is alphabetical (가나다순) by
// attraction name, which stays neutral with respect to that figure.
//
// A structural test (tests/no-rate-ranking.test.ts) greps the whole source
// tree for forbidden ranking-symbol names to guarantee this file — and
// everything else — never grows one.
import type { AttractionRow } from "./proxyClient";

export interface AttractionSummary {
  tAtsNm: string;
  rows: AttractionRow[];
}

/** Groups rows by attraction name, fixed alphabetical (가나다순) order. No other order is offered. */
export function groupAttractionsAlphabetically(items: AttractionRow[]): AttractionSummary[] {
  const byName = new Map<string, AttractionRow[]>();
  for (const row of items) {
    const bucket = byName.get(row.tAtsNm);
    if (bucket) bucket.push(row);
    else byName.set(row.tAtsNm, [row]);
  }
  return [...byName.entries()]
    .map(([tAtsNm, rows]) => ({ tAtsNm, rows }))
    .sort((a, b) => a.tAtsNm.localeCompare(b.tAtsNm, "ko"));
}
