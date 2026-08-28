// Thin client for the Workers proxy. The proxy base URL is a build-time
// public config value (not a secret) — it just points at the deployed
// Worker's origin, e.g. https://when-to-go-proxy.<subdomain>.workers.dev
const PROXY_BASE = import.meta.env.VITE_PROXY_BASE ?? "";

export interface SidoRegion {
  code: string;
  name: string;
}

export class ProxyError extends Error {}

interface LdongCode2Item {
  code: string;
  name: string;
}

interface UpstreamEnvelope {
  data: {
    response: {
      header: { resultCode: string; resultMsg: string };
      body: {
        items: { item: LdongCode2Item[] | LdongCode2Item };
        totalCount: number;
      };
    };
  };
  fetchedAt: number;
  cacheHit: boolean;
}

export async function fetchSidoList(): Promise<{ regions: SidoRegion[]; fetchedAt: number; cacheHit: boolean }> {
  const url = `${PROXY_BASE}/api/proxy?operation=ldongCode2&numOfRows=20&pageNo=1`;
  return fetchLdongCode2(url);
}

/** Signgu (시군구) list for a given sido. Callers must skip this for Sejong (single-tier). */
export async function fetchSigunguList(lDongRegnCd: string): Promise<{ regions: SidoRegion[]; fetchedAt: number; cacheHit: boolean }> {
  const url = `${PROXY_BASE}/api/proxy?operation=ldongCode2&numOfRows=100&pageNo=1&lDongRegnCd=${encodeURIComponent(lDongRegnCd)}`;
  return fetchLdongCode2(url);
}

async function fetchLdongCode2(url: string): Promise<{ regions: SidoRegion[]; fetchedAt: number; cacheHit: boolean }> {
  const res = await fetch(url);
  const body = (await res.json()) as unknown;

  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `proxy request failed with status ${res.status}`);
  }

  const envelope = body as UpstreamEnvelope;
  const rawItems = envelope.data?.response?.body?.items?.item;
  const items: LdongCode2Item[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  // A zero-item response for a syntactically valid request is a legitimate
  // "no data" state, not an error — callers must render it explicitly, never
  // silently as an indistinguishable empty list.
  return {
    regions: items.map((item) => ({ code: item.code, name: item.name })),
    fetchedAt: envelope.fetchedAt,
    cacheHit: envelope.cacheHit,
  };
}

export interface AttractionRow {
  baseYmd: string;
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

interface CollectEnvelope {
  items: AttractionRow[];
  integrity: CollectIntegrity;
  fetchedAt: number;
  cacheHit: boolean;
}

export type CollectOutcome =
  | { ok: true; items: AttractionRow[]; integrity: CollectIntegrity; fetchedAt: number; cacheHit: boolean }
  | { ok: false; integrity: CollectIntegrity; itemsFetched: number };

/**
 * Fully collects tatsCnctrRatedList via the worker's /api/collect route.
 * Throws ProxyError on transport/validation failure. Resolves `ok: false`
 * with the integrity verdict when the round-trip completed but a
 * completeness invariant failed — callers must render that as an explicit
 * incomplete state, never as if it were a normal successful result.
 */
export async function collectAttractions(areaCd: string, signguCd: string): Promise<CollectOutcome> {
  const url = `${PROXY_BASE}/api/collect?operation=tatsCnctrRatedList&areaCd=${encodeURIComponent(areaCd)}&signguCd=${encodeURIComponent(signguCd)}`;
  const res = await fetch(url);
  const body = (await res.json()) as unknown;

  if (res.status === 502 && body && typeof body === "object" && (body as { error?: string }).error === "incomplete_collection") {
    const errBody = body as { integrity: CollectIntegrity; itemsFetched: number };
    return { ok: false, integrity: errBody.integrity, itemsFetched: errBody.itemsFetched };
  }

  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `collect request failed with status ${res.status}`);
  }

  const envelope = body as CollectEnvelope;
  return { ok: true, items: envelope.items, integrity: envelope.integrity, fetchedAt: envelope.fetchedAt, cacheHit: envelope.cacheHit };
}

export interface StreamPageEvent {
  type: "page";
  pageNo: number;
  totalCount: number | null;
  items: AttractionRow[];
}
interface StreamDoneEvent {
  type: "done";
  integrity: CollectIntegrity;
}
interface StreamIncompleteEvent {
  type: "incomplete";
  integrity: CollectIntegrity;
}
interface StreamErrorEvent {
  type: "error";
  message: string;
}
type StreamEvent = StreamPageEvent | StreamDoneEvent | StreamIncompleteEvent | StreamErrorEvent;

export type StreamCollectOutcome =
  | { ok: true; items: AttractionRow[]; integrity: CollectIntegrity }
  | { ok: false; integrity?: CollectIntegrity; itemsFetched: number; message?: string };

/**
 * Progressive-render variant of collectAttractions(): reads NDJSON lines
 * from /api/collect/stream as they arrive and calls `onPage` with each
 * page's items as soon as the worker has fetched it — so a caller can show
 * results incrementally for a large sigungu (measured: 제주시 cache-miss
 * collection took ~5.0s for 8 pages) instead of a single multi-second
 * blocking wait. NEVER drops an attraction or truncates to a top-N — every
 * page's full item list is delivered, exactly as /api/collect would return
 * it, just incrementally.
 */
export async function collectAttractionsStreaming(
  areaCd: string,
  signguCd: string,
  onPage: (items: AttractionRow[], pageNo: number, totalCount: number | null) => void
): Promise<StreamCollectOutcome> {
  const url = `${PROXY_BASE}/api/collect/stream?operation=tatsCnctrRatedList&areaCd=${encodeURIComponent(areaCd)}&signguCd=${encodeURIComponent(signguCd)}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new ProxyError(`stream request failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const allItems: AttractionRow[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "page") {
        allItems.push(...event.items);
        onPage(event.items, event.pageNo, event.totalCount);
      } else if (event.type === "done") {
        return { ok: true, items: allItems, integrity: event.integrity };
      } else if (event.type === "incomplete") {
        return { ok: false, integrity: event.integrity, itemsFetched: allItems.length };
      } else if (event.type === "error") {
        return { ok: false, itemsFetched: allItems.length, message: event.message };
      }
    }
  }

  // Stream ended without a terminal line — treat as incomplete, never as success.
  return { ok: false, itemsFetched: allItems.length, message: "stream ended without a terminal event" };
}

export interface PoiRow {
  contentid: string;
  title: string;
  addr1: string;
  mapx: string;
  mapy: string;
}

export type PoiOutcome =
  | { ok: true; items: PoiRow[]; totalCount: number | null; fetchedAt: number; cacheHit: boolean }
  | { ok: false; failureReason?: string; itemsFetched: number };

interface PoiEnvelope {
  items: PoiRow[];
  totalCount: number | null;
  pages: number;
  fetchedAt: number;
  cacheHit: boolean;
}

/**
 * Fully collects the areaBasedList2 POI candidate index for a sigungu via
 * /api/poi. Resolves `ok: false` (never throws) when collection completed
 * but was incomplete — callers must surface that explicitly rather than
 * treating a truncated candidate pool as if it were the whole thing.
 */
export async function fetchPoiIndex(lDongRegnCd: string, lDongSignguCd: string): Promise<PoiOutcome> {
  const url = `${PROXY_BASE}/api/poi?lDongRegnCd=${encodeURIComponent(lDongRegnCd)}&lDongSignguCd=${encodeURIComponent(lDongSignguCd)}`;
  const res = await fetch(url);
  const body = (await res.json()) as unknown;

  if (res.status === 502 && body && typeof body === "object" && (body as { error?: string }).error === "incomplete_poi_collection") {
    const errBody = body as { failureReason?: string; itemsFetched: number };
    return { ok: false, failureReason: errBody.failureReason, itemsFetched: errBody.itemsFetched };
  }

  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `poi request failed with status ${res.status}`);
  }

  const envelope = body as PoiEnvelope;
  return { ok: true, items: envelope.items, totalCount: envelope.totalCount, fetchedAt: envelope.fetchedAt, cacheHit: envelope.cacheHit };
}

export interface RelatedAttractionRow {
  rank: number;
  name: string;
  category: string;
  signguName: string;
}

interface RelatedEnvelope {
  items: RelatedAttractionRow[];
  empty: boolean;
  totalCount: number | null;
  fetchedAt: number;
  cacheHit: boolean;
}

/**
 * Top-5 related-attraction names (TarRlteTarService1). Name-only — never
 * paired with a POI detail link (see worker/src/related.ts for why).
 * `empty: true` means the sigungu legitimately has zero related rows
 * (e.g. 경기도 화성시) — callers must render that as an explicit empty
 * state, not as an indistinguishable still-loading/error state.
 */
export async function fetchRelatedTop5(areaCd: string, signguCd: string, baseYm: string): Promise<RelatedEnvelope> {
  const url = `${PROXY_BASE}/api/related?areaCd=${encodeURIComponent(areaCd)}&signguCd=${encodeURIComponent(signguCd)}&baseYm=${encodeURIComponent(baseYm)}`;
  const res = await fetch(url);
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `related request failed with status ${res.status}`);
  }
  return body as RelatedEnvelope;
}

export interface DetailCommon {
  contentid: string;
  title: string;
  overview: string;
  addr1: string;
}

interface DetailCommonEnvelope {
  data: {
    response: {
      header: { resultCode: string; resultMsg: string };
      body: { items: { item: Record<string, unknown>[] | Record<string, unknown> } };
    };
  };
}

/** Request-scoped only — called ONLY after a single_match resolution, never persisted. */
export async function fetchDetailCommon(contentId: string): Promise<DetailCommon | null> {
  const url = `${PROXY_BASE}/api/proxy?operation=detailCommon2&contentId=${encodeURIComponent(contentId)}`;
  const res = await fetch(url);
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `detail request failed with status ${res.status}`);
  }
  const envelope = body as DetailCommonEnvelope;
  const rawItems = envelope.data?.response?.body?.items?.item;
  const arr = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  if (arr.length === 0) return null;
  const first = arr[0];
  return {
    contentid: String(first.contentid ?? ""),
    title: String(first.title ?? ""),
    overview: String(first.overview ?? ""),
    addr1: String(first.addr1 ?? ""),
  };
}

export interface DetailImage {
  originimgurl: string;
  smallimageurl: string;
}

interface DetailImageEnvelope {
  data: {
    response: {
      header: { resultCode: string; resultMsg: string };
      body: { items: { item: Record<string, unknown>[] | Record<string, unknown> } };
    };
  };
}

/** Request-scoped only — called ONLY after a single_match resolution, never persisted. */
export async function fetchDetailImages(contentId: string): Promise<DetailImage[]> {
  const url = `${PROXY_BASE}/api/proxy?operation=detailImage2&contentId=${encodeURIComponent(contentId)}&imageYN=Y`;
  const res = await fetch(url);
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `image request failed with status ${res.status}`);
  }
  const envelope = body as DetailImageEnvelope;
  const rawItems = envelope.data?.response?.body?.items?.item;
  const arr = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return arr.map((raw) => ({ originimgurl: String(raw.originimgurl ?? ""), smallimageurl: String(raw.smallimageurl ?? "") })).filter((img) => img.originimgurl);
}
