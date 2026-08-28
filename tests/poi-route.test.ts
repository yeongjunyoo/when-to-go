import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import { POI_PAGE_SIZE } from "../worker/src/poi";

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function poiUpstream(items: unknown[], totalCount: number) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item: items }, numOfRows: POI_PAGE_SIZE, pageNo: 1, totalCount } } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetCircuitForTests();
  cacheClearForTests();
  rateLimitClearForTests();
  historyClearForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

function req(query: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com/api/poi?${query}`, { headers: { "cf-connecting-ip": ip } });
}

describe("/api/poi route", () => {
  it("200 with complete POI set for a well-formed single-page response", async () => {
    const items = [{ contentid: "1", title: "남이섬", addr1: "강원특별자치도 춘천시", mapx: "1", mapy: "1" }];
    fetchSpy.mockResolvedValueOnce(poiUpstream(items, 1));
    const res = await worker.fetch(req("lDongRegnCd=51&lDongSignguCd=110"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(typeof body.fetchedAt).toBe("number");
  });

  it("rejects malformed lDongRegnCd/lDongSignguCd before calling upstream", async () => {
    const res1 = await worker.fetch(req("lDongRegnCd=5&lDongSignguCd=110"), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(req("lDongRegnCd=51&lDongSignguCd=10"), env);
    expect(res2.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("502 incomplete_poi_collection when totalCount doesn't match rows returned", async () => {
    const items = [{ contentid: "1", title: "남이섬", addr1: "강원특별자치도 춘천시", mapx: "1", mapy: "1" }];
    fetchSpy.mockResolvedValueOnce(poiUpstream(items, 5));
    const res = await worker.fetch(req("lDongRegnCd=51&lDongSignguCd=110"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("incomplete_poi_collection");
  });

  it("paginates across multiple pages and caches complete results", async () => {
    const page1 = Array.from({ length: POI_PAGE_SIZE }, (_, i) => ({ contentid: String(i), title: `poi${i}`, addr1: "제주특별자치도 제주시", mapx: "1", mapy: "1" }));
    const page2 = [{ contentid: "1271", title: "poiLast", addr1: "제주특별자치도 제주시", mapx: "1", mapy: "1" }];
    fetchSpy.mockResolvedValueOnce(poiUpstream(page1, 1001)).mockResolvedValueOnce(poiUpstream(page2, 1001));
    const res1 = await worker.fetch(req("lDongRegnCd=50&lDongSignguCd=110"), env);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.items).toHaveLength(1001);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const res2 = await worker.fetch(req("lDongRegnCd=50&lDongSignguCd=110"), env);
    const body2 = await res2.json();
    expect(body2.cacheHit).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // no additional upstream calls
  });
});
