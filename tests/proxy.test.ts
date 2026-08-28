import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import ldongFixture from "./fixtures/ldongCode2.json";

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";

const env: Env = {
  TOURAPI_KEY: FAKE_KEY,
  UPSTREAM_BASE: "https://apis.data.go.kr/B551011/",
};

function okUpstream(body: unknown = ldongFixture) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function errUpstream(resultCode: string) {
  return okUpstream({ response: { header: { resultCode, resultMsg: "ERR" }, body: {} } });
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
  return new Request(`https://proxy.example.com/api/proxy?${query}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

describe("secret injection contract", () => {
  it("1. rejects client-supplied serviceKey with 400", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&serviceKey=abc"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("serviceKey");
  });

  it("2. rejects client-supplied MobileApp with 400", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&MobileApp=x"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("MobileApp");
  });

  it("3. server injects serviceKey and MobileApp into upstream request", async () => {
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res = await worker.fetch(req("operation=ldongCode2"), env);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("serviceKey")).toBe(FAKE_KEY);
    expect(calledUrl.searchParams.get("MobileApp")).toBe("언제가지");
    expect(calledUrl.searchParams.get("MobileOS")).toBe("ETC");
  });
});

describe("allowlist", () => {
  it("4. rejects operations outside the allowlist, including lookalikes", async () => {
    const res1 = await worker.fetch(req("operation=ldongCode3"), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(req("operation=LdongCode2"), env);
    expect(res2.status).toBe(400);
    const res3 = await worker.fetch(req("operation=areaBasedList"), env);
    expect(res3.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("param schema", () => {
  it("5. rejects numOfRows above 1000", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&numOfRows=1001"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("numOfRows");
  });

  it("6a. rejects pageNo above constant fallback cap (10) when totalCount unknown", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&numOfRows=5&pageNo=11"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("pageNo");
  });

  it("6b. rejects contentId pageNo beyond bound consistently", async () => {
    const res = await worker.fetch(req("operation=detailCommon2&contentId=123&pageNo=999"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("pageNo");
  });

  it("7. rejects non-numeric contentId", async () => {
    const res = await worker.fetch(req("operation=detailCommon2&contentId=abc"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("contentId");
  });

  it("8. rejects malformed region codes and preserves leading zeros on valid ones", async () => {
    const badRes = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=5&signguCd=51110"), env);
    expect(badRes.status).toBe(400);
    const badBody = await badRes.json();
    expect(badBody.field).toBe("areaCd");

    fetchSpy.mockResolvedValueOnce(okUpstream());
    const goodRes = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=01&signguCd=01010"), env);
    expect(goodRes.status).toBe(200);
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("areaCd")).toBe("01");
    expect(calledUrl.searchParams.get("signguCd")).toBe("01010");
  });

  it("9. rejects tatsCnctrRatedList missing areaCd (only signguCd provided)", async () => {
    const res = await worker.fetch(req("operation=tatsCnctrRatedList&signguCd=51110"), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    // areaCd is required and missing -> validation should flag areaCd
    expect(body.field).toBe("areaCd");
  });
});

describe("rate limiting", () => {
  it("10. returns 429 once per-IP threshold is exceeded", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    let lastStatus = 200;
    for (let i = 0; i < 35; i++) {
      // vary pageNo/numOfRows lightly isn't needed since cache would short-circuit;
      // use distinct contentId-less op (ldongCode2) but change pageNo to avoid caching entirely masking rate limiting
      const res = await worker.fetch(req(`operation=ldongCode2&numOfRows=${5 + (i % 3)}`), env);
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("circuit breaker", () => {
  it("11a. warns at 490 calls via response header", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    for (let i = 0; i < 490; i++) {
      // Distinct IP per call so the per-IP rate limiter never interferes with
      // testing the separate global daily circuit breaker.
      const res = await worker.fetch(req(`operation=ldongCode2&numOfRows=${1 + (i % 900)}`, `10.0.${Math.floor(i / 250)}.${i % 250}`), env);
      expect(res.status).toBe(200);
    }
    const finalRes = await worker.fetch(req("operation=ldongCode2&numOfRows=999", "10.9.9.9"), env);
    expect(finalRes.headers.get("x-circuit-status")).toMatch(/warn/);
  }, 20000);

  it("11b. blocks upstream calls at 700 with explicit error, not fake data", async () => {
    fetchSpy.mockImplementation(async () => okUpstream());
    for (let i = 0; i < 700; i++) {
      await worker.fetch(req(`operation=ldongCode2&numOfRows=${1 + (i % 900)}`, `10.1.${Math.floor(i / 250)}.${i % 250}`), env);
    }
    const blockedRes = await worker.fetch(req("operation=ldongCode2&numOfRows=777", "10.9.9.9"), env);
    expect(blockedRes.status).toBe(503);
    const body = await blockedRes.json();
    expect(body.error).toBe("circuit_open");
  }, 20000);
});

describe("cache", () => {
  it("12a. does not cache error/non-0000 upstream responses", async () => {
    fetchSpy.mockResolvedValueOnce(errUpstream("0001"));
    const res1 = await worker.fetch(req("operation=ldongCode2&numOfRows=42"), env);
    expect(res1.status).toBe(502);

    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res2 = await worker.fetch(req("operation=ldongCode2&numOfRows=42"), env);
    expect(res2.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("12b. serves cache hit without re-calling upstream, then refetches after TTL", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res1 = await worker.fetch(req("operation=ldongCode2&numOfRows=43"), env);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.cacheHit).toBe(false);

    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res2 = await worker.fetch(req("operation=ldongCode2&numOfRows=43"), env);
    const body2 = await res2.json();
    expect(body2.cacheHit).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res3 = await worker.fetch(req("operation=ldongCode2&numOfRows=43"), env);
    const body3 = await res3.json();
    expect(body3.cacheHit).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("12c. surfaces failure instead of stale data when refetch after expiry fails", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(okUpstream());
    const res1 = await worker.fetch(req("operation=ldongCode2&numOfRows=44"), env);
    expect((await res1.json()).cacheHit).toBe(false);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
    fetchSpy.mockRejectedValueOnce(new Error("upstream unreachable"));
    const res2 = await worker.fetch(req("operation=ldongCode2&numOfRows=44"), env);
    expect(res2.status).toBe(502);
    const body2 = await res2.json();
    expect(body2.error).toBe("upstream_fetch_failed");
    vi.useRealTimers();
  });
});

describe("redaction", () => {
  it("13. never leaks the service key in logs, error bodies, or responses", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchSpy.mockRejectedValueOnce(new Error(`fetch failed for https://apis.data.go.kr/x?serviceKey=${FAKE_KEY}`));
    const res = await worker.fetch(req("operation=ldongCode2&numOfRows=45"), env);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(FAKE_KEY);

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(allLogged).not.toContain(FAKE_KEY);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
