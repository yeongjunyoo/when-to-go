// Full-pagination collector for areaBasedList2 (POI candidate set for a
// single sigungu), used as the B-live entity-resolution index. Reuses the
// same completeness discipline as collect.ts — never returns a partial POI
// set silently as if it were complete.
import { fetchUpstreamPage, UpstreamEnv } from "./upstream";
import { parseTotalCount } from "./collect";

export const POI_PAGE_SIZE = 1000;
export const POI_MAX_PAGES = 20; // observed max: 제주시 2 pages (1,271 rows); generous headroom, same rationale as MAX_PAGES in collect.ts.

export interface PoiItem {
  contentid: string;
  title: string;
  addr1: string;
  mapx: string;
  mapy: string;
}

export interface PoiCollectResult {
  items: PoiItem[];
  complete: boolean;
  totalCount: number | null;
  rawFetched: number;
  pages: number;
  failureReason?: string;
}

export async function collectPoiIndex(lDongRegnCd: string, lDongSignguCd: string, env: UpstreamEnv): Promise<PoiCollectResult> {
  const rawItems: PoiItem[] = [];
  const totalCounts = new Set<number>();
  const seenKeys = new Set<string>();
  let pageNo = 1;
  let pages = 0;
  let knownTotal: number | null = null;

  while (true) {
    const result = await fetchUpstreamPage(
      { operation: "areaBasedList2", extraParams: { lDongRegnCd, lDongSignguCd }, numOfRows: POI_PAGE_SIZE, pageNo },
      env
    );

    if (!result.ok) {
      return buildResult(rawItems, totalCounts, pages, `upstream page ${pageNo} failed: ${result.error}`);
    }

    const { items: pageItems, totalCount } = extractPage(result.body);
    pages += 1;
    if (totalCount !== null) totalCounts.add(totalCount);
    rawItems.push(...pageItems);
    if (totalCount !== null) knownTotal = totalCount;

    const fetchedSoFar = pageNo * POI_PAGE_SIZE;
    const doneByCount = knownTotal !== null && fetchedSoFar >= knownTotal;
    const doneByShortPage = pageItems.length < POI_PAGE_SIZE;
    if (doneByCount || doneByShortPage || pageItems.length === 0) break;

    if (pageNo >= POI_MAX_PAGES) {
      return buildResult(rawItems, totalCounts, pages, `pagination exceeded POI_MAX_PAGES=${POI_MAX_PAGES} without a terminal page`);
    }

    const before = seenKeys.size;
    for (const item of pageItems) seenKeys.add(`${item.contentid}::${item.title}`);
    if (seenKeys.size === before) {
      return buildResult(rawItems, totalCounts, pages, `page ${pageNo} returned no new records; pagination is not advancing`);
    }

    pageNo += 1;
  }

  return buildResult(rawItems, totalCounts, pages);
}

function extractPage(body: unknown): { items: PoiItem[]; totalCount: number | null } {
  if (typeof body !== "object" || body === null) return { items: [], totalCount: null };
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const bodyField = response?.body as Record<string, unknown> | undefined;
  const totalCount = parseTotalCount(bodyField?.totalCount);
  const itemsField = bodyField?.items as Record<string, unknown> | undefined;
  const rawItem = itemsField?.item;
  const arr = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
  const items = arr.map((raw) => normalizeItem(raw as Record<string, unknown>));
  return { items, totalCount };
}

function normalizeItem(raw: Record<string, unknown>): PoiItem {
  return {
    contentid: String(raw.contentid ?? ""),
    title: String(raw.title ?? ""),
    addr1: String(raw.addr1 ?? ""),
    mapx: String(raw.mapx ?? ""),
    mapy: String(raw.mapy ?? ""),
  };
}

function buildResult(items: PoiItem[], totalCounts: Set<number>, pages: number, failureReason?: string): PoiCollectResult {
  const stableTotal = totalCounts.size === 1;
  const totalCount = stableTotal ? [...totalCounts][0] : null;
  const rawFetched = items.length;
  const isLegitimatelyEmpty = stableTotal && totalCount === 0 && rawFetched === 0;
  const rawExact = isLegitimatelyEmpty || (stableTotal && totalCount !== null && rawFetched === totalCount);
  const complete = !failureReason && stableTotal && rawExact;

  let reason = failureReason;
  if (!complete && !reason) {
    if (!stableTotal) reason = `totalCount unstable across pages (saw ${[...totalCounts].join(", ")})`;
    else if (!rawExact) reason = `rawFetched (${rawFetched}) != totalCount (${totalCount})`;
  }

  return { items, complete, totalCount, rawFetched, pages, failureReason: reason };
}
