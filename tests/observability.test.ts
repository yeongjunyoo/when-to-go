import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import ldongFixture from "./fixtures/ldongCode2.json";

// L4 관측성: 1차 심사의 "실제 호출 내역 대조 검증"에 직접 대응하는 엔드포인트.
// 오퍼레이션별·일별 호출 수, 응답 코드 분포, MobileApp 값, 서킷 브레이커
// 상태(쿼터 계기판)를 하나의 응답으로 노출한다. 인증키는 절대 포함하지 않는다.

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function okUpstream() {
  return new Response(JSON.stringify(ldongFixture), { status: 200, headers: { "content-type": "application/json" } });
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

function req(path_: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com${path_}`, { headers: { "cf-connecting-ip": ip } });
}

describe("/api/observability — 1차 심사 대조 증거", () => {
  it("호출 이력이 없을 때도 200 + 빈 이력 배열로 응답한다", async () => {
    const res = await worker.fetch(req("/api/observability"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callHistory).toEqual([]);
    expect(body.circuit.status).toBe("ok");
    expect(body.circuit.count).toBe(0);
  });

  it("실제 upstream 호출 후 오퍼레이션별·일별·MobileApp 값이 정확히 집계된다", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    await worker.fetch(req("/api/proxy?operation=ldongCode2&numOfRows=5"), env);

    const res = await worker.fetch(req("/api/observability"), env);
    const body = await res.json();
    expect(body.callHistory).toHaveLength(1);
    expect(body.callHistory[0].operation).toBe("ldongCode2");
    expect(body.callHistory[0].count).toBe(1);
    expect(body.callHistory[0].resultCodes["0000"]).toBe(1);
    expect(body.callHistory[0].mobileAppValues).toEqual(["언제가지"]);
  });

  it("인증키가 응답 어디에도 등장하지 않는다", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    await worker.fetch(req("/api/proxy?operation=ldongCode2"), env);
    const res = await worker.fetch(req("/api/observability"), env);
    const text = await res.text();
    expect(text).not.toContain(FAKE_KEY);
  });

  it("서킷 브레이커 임계값(490/700)이 응답에 노출되어 쿼터 계기판으로 쓸 수 있다", async () => {
    const res = await worker.fetch(req("/api/observability"), env);
    const body = await res.json();
    expect(body.circuit.warnThreshold).toBe(490);
    expect(body.circuit.blockThreshold).toBe(700);
  });
});
