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
