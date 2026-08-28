import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function relatedUpstream(items: unknown[], totalCount: number) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item: items }, numOfRows: 1000, pageNo: 1, totalCount } } }),
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
  return new Request(`https://proxy.example.com/api/related?${query}`, { headers: { "cf-connecting-ip": ip } });
}

describe("/api/related route — 티맵 연관 top5", () => {
  it("returns the top 5 rlteRank rows, sorted by rank", async () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      tAtsNm: "감포항",
      rlteRank: String(9 - i), // reversed to prove sorting happens
      rlteTatsNm: `연관지${9 - i}`,
      rlteCtgrySclsNm: "자연경관",
      rlteSignguNm: "경주시",
      baseYm: "202605",
    }));
    fetchSpy.mockResolvedValueOnce(relatedUpstream(items, 9));
    const res = await worker.fetch(req("areaCd=47&signguCd=47130&baseYm=202605"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.items.map((i: { rank: number }) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(body.empty).toBe(false);
  });

  it("★ 화성시처럼 연관 데이터가 없는 시군구는 empty:true로 명시된다", async () => {
    fetchSpy.mockResolvedValueOnce(relatedUpstream([], 0));
    const res = await worker.fetch(req("areaCd=41&signguCd=41590&baseYm=202605"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.empty).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("rejects malformed params before calling upstream", async () => {
    const res1 = await worker.fetch(req("areaCd=4&signguCd=41590&baseYm=202605"), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(req("areaCd=41&signguCd=4159&baseYm=202605"), env);
    expect(res2.status).toBe(400);
    const res3 = await worker.fetch(req("areaCd=41&signguCd=41590&baseYm=2026"), env);
    expect(res3.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
