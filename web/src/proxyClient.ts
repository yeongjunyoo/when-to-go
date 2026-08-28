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
  const res = await fetch(url);
  const body = (await res.json()) as unknown;

  if (!res.ok) {
    const errBody = body as { error?: string; message?: string };
    throw new ProxyError(errBody.message ?? errBody.error ?? `proxy request failed with status ${res.status}`);
  }

  const envelope = body as UpstreamEnvelope;
  const rawItems = envelope.data?.response?.body?.items?.item;
  const items: LdongCode2Item[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  if (items.length === 0) {
    throw new ProxyError("proxy returned zero regions — upstream may be degraded");
  }

  return {
    regions: items.map((item) => ({ code: item.code, name: item.name })),
    fetchedAt: envelope.fetchedAt,
    cacheHit: envelope.cacheHit,
  };
}
