// Full-pagination collector for tatsCnctrRatedList (and any operation whose
// items are dedupable by a stable key). A single logical query here can
// mean multiple upstream HTTP calls; this module hides that behind one
// call and reports a hard pass/fail integrity verdict instead of silently
// returning partial data as if it were complete.
//
// Completeness invariants (ALL must hold for a collection to be marked
// complete — violating any one of them means the caller must treat the
// result as incomplete, never as quietly-successful):
//   1. stableTotal    — every page's totalCount agrees.
//   2. rawExact       — rawFetched (sum of raw items across all pages) == stableTotal.
//   3. uniqueExact    — uniqueFetched (deduped by (tAtsNm, baseYmd)) == stableTotal.
//                        If dedup collapses the count, that is a KEY COLLISION,
//                        not success — it must never be silently accepted.
//   4. windowExact    — every attraction has exactly `windowLength` rows,
//                        where windowLength = the number of distinct baseYmd
//                        values observed across the whole collection. An
//                        attraction with fewer/more rows than the window
//                        means data is missing or duplicated for it.
import { fetchUpstreamPage, UpstreamEnv } from "./upstream";

export const PAGE_SIZE = 1000;

export interface TatsCnctrItem {
  baseYmd: string;
  areaCd: string;
  areaNm: string;
  signguCd: string;
  signguNm: string;
  tAtsNm: string;
  cnctrRate: number;
}

export interface CollectIntegrity {
  stableTotal: boolean;
  rawExact: boolean;
  uniqueExact: boolean;
  windowExact: boolean;
  complete: boolean;
  totalCount: number | null;
  rawFetched: number;
  uniqueFetched: number;
  pages: number;
  windowLength: number;
  offendingAttractions: string[];
  failureReason?: string;
}

export interface CollectResult {
  items: TatsCnctrItem[];
  integrity: CollectIntegrity;
}

/**
 * Fully paginates tatsCnctrRatedList for a given areaCd/signguCd and checks
 * all 4 completeness invariants. Never returns a "complete: true" result
 * that violates any invariant, and never fabricates rows to paper over a
 * gap — failure is surfaced via `integrity`.
 */
export async function collectTatsCnctrRatedList(
  areaCd: string,
  signguCd: string,
  env: UpstreamEnv,
  onPage?: (pageItems: TatsCnctrItem[], pageNo: number, totalCount: number | null) => void
): Promise<CollectResult> {
  const rawItems: TatsCnctrItem[] = [];
  const totalCounts = new Set<number>();
  let pageNo = 1;
  let pages = 0;
  let knownTotal: number | null = null;

  while (true) {
    const result = await fetchUpstreamPage(
      { operation: "tatsCnctrRatedList", extraParams: { areaCd, signguCd }, numOfRows: PAGE_SIZE, pageNo },
      env
    );

    if (!result.ok) {
      return {
        items: rawItems,
        integrity: buildFailedIntegrity(rawItems, totalCounts, pages, `upstream page ${pageNo} failed: ${result.error}`),
      };
    }

    const { items: pageItems, totalCount } = extractPage(result.body);
    pages += 1;
    if (totalCount !== null) totalCounts.add(totalCount);
    rawItems.push(...pageItems);
    onPage?.(pageItems, pageNo, totalCount);

    if (totalCount !== null) knownTotal = totalCount;

    const fetchedSoFar = pageNo * PAGE_SIZE;
    const doneByCount = knownTotal !== null && fetchedSoFar >= knownTotal;
    const doneByShortPage = pageItems.length < PAGE_SIZE;
    if (doneByCount || doneByShortPage || pageItems.length === 0) break;
    pageNo += 1;
  }

  return { items: rawItems, integrity: buildIntegrity(rawItems, totalCounts, pages) };
}

function extractPage(body: unknown): { items: TatsCnctrItem[]; totalCount: number | null } {
  if (typeof body !== "object" || body === null) return { items: [], totalCount: null };
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const bodyField = response?.body as Record<string, unknown> | undefined;
  const totalCountRaw = bodyField?.totalCount;
  const totalCount = typeof totalCountRaw === "number" ? totalCountRaw : null;
  const itemsField = bodyField?.items as Record<string, unknown> | undefined;
  const rawItem = itemsField?.item;
  const arr = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
  const items = arr.map((raw) => normalizeItem(raw as Record<string, unknown>));
  return { items, totalCount };
}

function normalizeItem(raw: Record<string, unknown>): TatsCnctrItem {
  return {
    baseYmd: String(raw.baseYmd ?? ""),
    areaCd: String(raw.areaCd ?? ""),
    areaNm: String(raw.areaNm ?? ""),
    signguCd: String(raw.signguCd ?? ""),
    signguNm: String(raw.signguNm ?? ""),
    tAtsNm: String(raw.tAtsNm ?? ""),
    cnctrRate: typeof raw.cnctrRate === "number" ? raw.cnctrRate : Number(raw.cnctrRate ?? NaN),
  };
}

function dedupeKey(item: TatsCnctrItem): string {
  return `${item.tAtsNm}::${item.baseYmd}`;
}

function buildIntegrity(rawItems: TatsCnctrItem[], totalCounts: Set<number>, pages: number): CollectIntegrity {
  const stableTotal = totalCounts.size === 1;
  const totalCount = stableTotal ? [...totalCounts][0] : null;

  const rawFetched = rawItems.length;
  const rawExact = stableTotal && totalCount !== null && rawFetched === totalCount;

  const deduped = new Map<string, TatsCnctrItem>();
  for (const item of rawItems) deduped.set(dedupeKey(item), item);
  const uniqueFetched = deduped.size;
  const uniqueExact = stableTotal && totalCount !== null && uniqueFetched === totalCount;

  // Window length = number of distinct baseYmd values seen in the unique set.
  const distinctDates = new Set([...deduped.values()].map((i) => i.baseYmd));
  const windowLength = distinctDates.size;

  const rowsPerAttraction = new Map<string, number>();
  for (const item of deduped.values()) {
    rowsPerAttraction.set(item.tAtsNm, (rowsPerAttraction.get(item.tAtsNm) ?? 0) + 1);
  }
  const offendingAttractions: string[] = [];
  for (const [name, count] of rowsPerAttraction) {
    if (count !== windowLength) offendingAttractions.push(name);
  }
  const windowExact = windowLength > 0 && offendingAttractions.length === 0;

  const complete = stableTotal && rawExact && uniqueExact && windowExact;

  let failureReason: string | undefined;
  if (!complete) {
    const reasons: string[] = [];
    if (!stableTotal) reasons.push(`totalCount unstable across pages (saw ${[...totalCounts].join(", ")})`);
    if (stableTotal && !rawExact) reasons.push(`rawFetched (${rawFetched}) != totalCount (${totalCount})`);
    if (stableTotal && !uniqueExact) reasons.push(`uniqueFetched (${uniqueFetched}) != totalCount (${totalCount}) — likely (tAtsNm, baseYmd) key collision`);
    if (!windowExact) reasons.push(`${offendingAttractions.length} attraction(s) have row count != window length (${windowLength})`);
    failureReason = reasons.join("; ");
  }

  return {
    stableTotal,
    rawExact,
    uniqueExact,
    windowExact,
    complete,
    totalCount,
    rawFetched,
    uniqueFetched,
    pages,
    windowLength,
    offendingAttractions,
    failureReason,
  };
}

function buildFailedIntegrity(rawItems: TatsCnctrItem[], totalCounts: Set<number>, pages: number, reason: string): CollectIntegrity {
  const base = buildIntegrity(rawItems, totalCounts, pages);
  return { ...base, complete: false, failureReason: reason };
}
