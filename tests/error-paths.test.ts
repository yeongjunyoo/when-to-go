import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import { collectTatsCnctrRatedList, PAGE_SIZE } from "../worker/src/collect";
import ldongFixture from "./fixtures/ldongCode2.json";

// B6 오류 경로 전수 — "실패를 감추지 않는다"는 하드룰을 각 경로에서 픽스처로
// 고정한다. 대부분은 이미 다른 스위트(proxy.test.ts, cohort-fixes.test.ts,
// empty-region.test.ts, collect.test.ts)에 흩어져 검증돼 있으나, 여기서는
// B6가 요구하는 5경로를 한곳에 모아 명시적으로 확인한다.

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function okUpstream(body: unknown = ldongFixture) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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

function req(path: string, query: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com${path}?${query}`, { headers: { "cf-connecting-ip": ip } });
}

describe("오류 경로 1: upstream 429 (rate limit) — 이미 proxy.test.ts #10에서 검증됨(참조)", () => {
  it("★ 클라이언트가 임계를 넘기면 이 프록시 자체가 429를 반환한다 (가짜 데이터로 위장하지 않는다)", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    let lastStatus = 200;
    for (let i = 0; i < 35; i++) {
      const res = await worker.fetch(req("/api/proxy", `operation=ldongCode2&numOfRows=${5 + (i % 3)}`), env);
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("오류 경로 2: upstream 5xx / 타임아웃 — 명시적 실패 노출", () => {
  it("upstream이 HTTP 500을 반환하면 502로 명시적 실패를 노출한다 (빈 목록으로 위장하지 않는다)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("internal error", { status: 500 }));
    const res = await worker.fetch(req("/api/proxy", "operation=ldongCode2"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_bad_response");
  });

  it("upstream fetch가 타임아웃/네트워크 오류로 reject되면 502 + 명시적 오류 메시지를 낸다", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network timeout"));
    const res = await worker.fetch(req("/api/proxy", "operation=ldongCode2"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_fetch_failed");
  });

  it("upstream이 502/503 게이트웨이 오류를 반환해도 200으로 위장하지 않는다", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const res = await worker.fetch(req("/api/proxy", "operation=ldongCode2"), env);
    expect(res.status).toBe(502);
  });
});

describe("오류 경로 3: 필드 소멸(파싱 실패) — R2 계약, fallback 금지", () => {
  it("items 필드 자체가 사라진 응답은 파싱 실패로 노출되지 대충 빈 배열로 넘어가지 않는다", async () => {
    // resultCode는 정상(0000)인데 body.items가 완전히 빠진 기형 응답 — 실제
    // "필드 소멸" 시나리오(업스트림 스키마가 바뀌어 items 자체가 없어짐)를 재현.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { header: { resultCode: "0000" }, body: { totalCount: 5 } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    // totalCount=5인데 items가 없어 rawFetched=0 -> rawExact 위반 -> 명시적 불완전.
    expect(result.integrity.complete).toBe(false);
    expect(result.integrity.rawFetched).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("response 최상위 객체 자체가 사라진(완전히 다른 스키마) 응답도 안전하게 실패로 처리된다", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: "shape" }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await worker.fetch(req("/api/proxy", "operation=ldongCode2"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_error");
  });

  it("upstream이 유효하지 않은 JSON(파싱 자체 불가)을 반환하면 명시적 502로 드러난다", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const res = await worker.fetch(req("/api/proxy", "operation=ldongCode2"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_bad_response");
  });
});

describe("오류 경로 4: 서킷 브레이커 발동(700콜) — 명시적 상태 표시, 이미 proxy.test.ts #11b에서 검증됨(참조)", () => {
  it("★ 700콜 임계 도달 시 503 + circuit_open을 명시적으로 드러낸다 (가짜 데이터 없음)", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    for (let i = 0; i < 700; i++) {
      await worker.fetch(req("/api/proxy", `operation=ldongCode2&numOfRows=${1 + (i % 900)}`, `10.2.${Math.floor(i / 250)}.${i % 250}`), env);
    }
    const blockedRes = await worker.fetch(req("/api/proxy", "operation=ldongCode2&numOfRows=888", "10.9.9.8"), env);
    expect(blockedRes.status).toBe(503);
    const body = await blockedRes.json();
    expect(body.error).toBe("circuit_open");
    expect(body.message).toMatch(/circuit breaker open/);
  }, 20000);

  it("서킷이 열려 있으면 /api/collect도 동일하게 명시적으로 차단된다(부분 데이터로 위장하지 않는다)", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    for (let i = 0; i < 700; i++) {
      await worker.fetch(req("/api/proxy", `operation=ldongCode2&numOfRows=${1 + (i % 900)}`, `10.3.${Math.floor(i / 250)}.${i % 250}`), env);
    }
    const collectRes = await worker.fetch(req("/api/collect", "operation=tatsCnctrRatedList&areaCd=51&signguCd=51110", "10.9.9.7"), env);
    expect(collectRes.status).toBe(502); // integrity.complete=false due to circuit-blocked page fetch
    const body = await collectRes.json();
    expect(body.integrity.complete).toBe(false);
  }, 20000);
});

describe("오류 경로 5: 수집 불완전 — '데이터 수집 중' 표시, 추천 미생성", () => {
  it("수집 불완전 시 /api/collect가 502 + incomplete_collection을 반환한다 (부분 성공으로 위장하지 않는다)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: { header: { resultCode: "0000" }, body: { totalCount: 5, items: { item: [{ tAtsNm: "A", baseYmd: "20260828", cnctrRate: "10" }] } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const res = await worker.fetch(req("/api/collect", "operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("incomplete_collection");
    expect(body.integrity.complete).toBe(false);
  });

  it("프론트 recommendedDays()는 수집 불완전 플래그가 꺼지면(collectionComplete=false) 추천을 내지 않는다", async () => {
    const { recommendedDays } = await import("../web/src/attractionAnalysis");
    const calendar = [
      { baseYmd: "20260828", cnctrRate: 10 },
      { baseYmd: "20260829", cnctrRate: 20 },
    ];
    // recommendedDays 자체는 collectionComplete를 인자로 받지 않고, 호출자
    // (AttractionDetail.tsx)가 그 플래그로 recommendedDays() 호출 여부를
    // 게이팅한다 — 즉 "부분 응답이면 추천을 내지 않는다"는 계약은 호출 위치에
    // 있다. 여기서는 그 게이팅 소스를 정적으로 고정한다.
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(__dirname, "../web/src/AttractionDetail.tsx"),
      "utf8"
    );
    expect(source).toMatch(/collectionComplete\s*\?\s*recommendedDays/);
    // 완전한 데이터가 있을 때는 정상적으로 추천이 나온다는 것도 확인(대조군).
    expect(recommendedDays(calendar).length).toBeGreaterThan(0);
  });
});
