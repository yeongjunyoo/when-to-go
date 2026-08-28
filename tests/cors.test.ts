import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import ldongFixture from "./fixtures/ldongCode2.json";

// 이 스위트가 존재하는 이유:
// B0 최초 배포본에는 CORS 처리가 아예 없었고 OPTIONS는 405로 거부됐다.
// 프록시 자체는 curl로 200을 냈기 때문에 "동작한다"고 오판하기 쉬웠지만,
// 배포된 Pages URL의 브라우저에서는 전 호출이 차단되는 상태였다 —
// 즉 상용 런칭 요건(모바일 브라우저 접속·동작)이 실제로는 미충족이었다.
// 계약을 테스트로 고정해 재발을 막는다.

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const PAGES_ORIGIN = "https://when-to-go-7s6.pages.dev";

const env: Env = {
  TOURAPI_KEY: FAKE_KEY,
  UPSTREAM_BASE: "https://apis.data.go.kr/B551011/",
};

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

afterEach(() => {
  fetchSpy.mockRestore();
});

function reqWithOrigin(query: string, origin: string, ip = "9.9.9.9"): Request {
  return new Request(`https://proxy.example.com/api/proxy?${query}`, {
    headers: { "cf-connecting-ip": ip, origin },
  });
}

describe("CORS contract", () => {
  it("preflight OPTIONS from the deployed Pages origin is allowed", async () => {
    const res = await worker.fetch(
      new Request("https://proxy.example.com/api/proxy", {
        method: "OPTIONS",
        headers: { origin: PAGES_ORIGIN, "cf-connecting-ip": "9.9.9.9" },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("successful proxy responses carry the allow-origin header for the Pages origin", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res = await worker.fetch(reqWithOrigin("operation=ldongCode2&numOfRows=3", PAGES_ORIGIN), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("Pages preview deployments of the same project are allowed", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const preview = "https://c58787d8.when-to-go-7s6.pages.dev";
    const res = await worker.fetch(reqWithOrigin("operation=ldongCode2&numOfRows=4", preview), env);
    expect(res.headers.get("access-control-allow-origin")).toBe(preview);
  });

  it("unknown origins receive no allow-origin header", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res = await worker.fetch(reqWithOrigin("operation=ldongCode2&numOfRows=5", "https://evil.example.com"), env);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("validation errors still carry CORS headers so the browser can read the message", async () => {
    const res = await worker.fetch(reqWithOrigin("operation=ldongCode2&serviceKey=leak", PAGES_ORIGIN), env);
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("health endpoint also honors CORS", async () => {
    const res = await worker.fetch(
      new Request("https://proxy.example.com/api/health", {
        headers: { origin: PAGES_ORIGIN, "cf-connecting-ip": "9.9.9.9" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("requests without an Origin header still work (curl, server-to-server)", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res = await worker.fetch(
      new Request("https://proxy.example.com/api/proxy?operation=ldongCode2&numOfRows=6", {
        headers: { "cf-connecting-ip": "9.9.9.9" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
