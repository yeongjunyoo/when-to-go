import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import { PAGE_SIZE } from "../worker/src/collect";

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function tatsItem(tAtsNm: string, baseYmd: string) {
  return { baseYmd, areaCd: "51", areaNm: "강원", signguCd: "51110", signguNm: "춘천시", tAtsNm, cnctrRate: 50 };
}

function upstreamOk(items: ReturnType<typeof tatsItem>[], totalCount: number) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { items: { item: items }, numOfRows: PAGE_SIZE, pageNo: 1, totalCount } } }),
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

afterEach(() => {
  fetchSpy.mockRestore();
});

function req(query: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com/api/collect?${query}`, { headers: { "cf-connecting-ip": ip } });
}

describe("/api/collect route", () => {
  it("returns 200 with complete integrity for a fully consistent dataset", async () => {
    const items = [tatsItem("남이섬", "20260828"), tatsItem("남이섬", "20260829")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(items, 2));
    const res = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.integrity.complete).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(typeof body.fetchedAt).toBe("number");
  });

  it("returns 502 with incomplete_collection error and does NOT hide the failure as success", async () => {
    // totalCount says 3 but only 2 items come back -> rawExact violated.
    const items = [tatsItem("남이섬", "20260828"), tatsItem("남이섬", "20260829")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(items, 3));
    const res = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("incomplete_collection");
    expect(body.integrity.complete).toBe(false);
  });

  it("rejects operations other than tatsCnctrRatedList", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&areaCd=51&signguCd=51110"), env);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed areaCd/signguCd before calling upstream", async () => {
    const res1 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=5&signguCd=51110"), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=5110"), env);
    expect(res2.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not cache an incomplete collection: retrying re-hits upstream", async () => {
    const badItems = [tatsItem("남이섬", "20260828")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(badItems, 5));
    const res1 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res1.status).toBe(502);

    const goodItems = [tatsItem("남이섬", "20260828")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(goodItems, 1));
    const res2 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res2.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("caches a complete collection and serves subsequent identical requests without re-hitting upstream", async () => {
    const items = [tatsItem("남이섬", "20260828")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(items, 1));
    const res1 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect((await res1.json()).cacheHit).toBe(false);

    const res2 = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect((await res2.json()).cacheHit).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
