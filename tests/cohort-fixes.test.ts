import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker, { Env } from "../worker/src/index";
import { parseRate, parseTotalCount, MAX_PAGES, PAGE_SIZE, collectTatsCnctrRatedList } from "../worker/src/collect";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";

// VB001 완료 코호트 리뷰에서 architect가 잡은 HIGH 3건 + MEDIUM 1건의 회귀 테스트.
// 전부 "가정한 모양을 테스트해서 통과하던" 계열이라, 여기서는 실제 응답이 줄 수 있는
// 모양(빈 문자열, 공백, 문자열 숫자, 페이징 미전진)을 직접 넣는다.

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetCircuitForTests();
  cacheClearForTests();
  rateLimitClearForTests();
  historyClearForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

describe("DATA-B2-01 — 결측 집중률이 0으로 날조되지 않는다", () => {
  it("빈 문자열은 NaN이다 (Number('')는 0이라 그대로 쓰면 결측이 0%가 된다)", () => {
    expect(parseRate("")).toBeNaN();
  });

  it("공백 문자열도 NaN이다", () => {
    expect(parseRate("   ")).toBeNaN();
    expect(parseRate("\t\n")).toBeNaN();
  });

  it("null·undefined·객체·배열도 NaN이다", () => {
    expect(parseRate(null)).toBeNaN();
    expect(parseRate(undefined)).toBeNaN();
    expect(parseRate({})).toBeNaN();
    expect(parseRate([])).toBeNaN();
  });

  it("비수치 문자열은 NaN이다", () => {
    expect(parseRate("N/A")).toBeNaN();
    expect(parseRate("-")).toBeNaN();
  });

  it("정상 값은 그대로 통과한다", () => {
    expect(parseRate("44.92")).toBeCloseTo(44.92);
    expect(parseRate(44.92)).toBeCloseTo(44.92);
    expect(parseRate("0")).toBe(0);
    expect(parseRate(0)).toBe(0);
  });

  it("Infinity·NaN 숫자는 NaN으로 떨어진다", () => {
    expect(parseRate(Infinity)).toBeNaN();
    expect(parseRate(NaN)).toBeNaN();
  });

  it("★ 진짜 0과 결측을 구별한다 — 이게 핵심이다", () => {
    // 실제 0%는 유효한 관측이고, 빈 문자열은 결측이다. 둘이 같아지면
    // 결측일이 '가장 한산한 날'로 추천 1순위에 올라간다.
    expect(parseRate("0")).toBe(0);
    expect(Number.isFinite(parseRate("0"))).toBe(true);
    expect(Number.isFinite(parseRate(""))).toBe(false);
  });
});

describe("CODE-B2-03 — totalCount가 문자열이어도 종료 조건이 작동한다", () => {
  it("문자열 숫자를 파싱한다", () => {
    expect(parseTotalCount("7320")).toBe(7320);
    expect(parseTotalCount(7320)).toBe(7320);
  });

  it("빈 문자열·비수치·null은 null이다", () => {
    expect(parseTotalCount("")).toBeNull();
    expect(parseTotalCount("   ")).toBeNull();
    expect(parseTotalCount("many")).toBeNull();
    expect(parseTotalCount(null)).toBeNull();
    expect(parseTotalCount(undefined)).toBeNull();
  });
});

describe("CODE-B2-03 — 페이징이 전진하지 않으면 쿼터를 태우지 않고 실패한다", () => {
  function fullPage(totalCount: unknown, seed: string) {
    // 항상 꽉 찬 1000행을 돌려주는 페이지 (upstream이 pageNo를 무시하는 상황)
    const item = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      baseYmd: `2026090${(i % 9) + 1}`,
      areaCd: "50",
      areaNm: "제주",
      signguCd: "50110",
      signguNm: "제주시",
      tAtsNm: `${seed}-${i}`,
      cnctrRate: "50.0",
    }));
    return new Response(JSON.stringify({ response: { header: { resultCode: "0000" }, body: { totalCount, items: { item } } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("동일 레코드만 반복 반환하면 즉시 중단하고 불완전으로 판정한다", async () => {
    // 매번 같은 seed = 새 레코드 0건 → 전진하지 않음
    fetchSpy.mockImplementation(async () => fullPage(null, "same"));
    const result = await collectTatsCnctrRatedList("50", "50110", env);
    expect(result.integrity.complete).toBe(false);
    expect(String(result.integrity.failureReason)).toMatch(/not advancing|no new records/i);
    // 상한(20)에 훨씬 못 미치는 호출로 끝나야 한다
    expect(fetchSpy.mock.calls.length).toBeLessThan(5);
  });

  it("매번 새 레코드를 주며 끝나지 않으면 MAX_PAGES에서 끊는다", async () => {
    let n = 0;
    fetchSpy.mockImplementation(async () => fullPage(null, `p${n++}`));
    const result = await collectTatsCnctrRatedList("50", "50110", env);
    expect(result.integrity.complete).toBe(false);
    expect(String(result.integrity.failureReason)).toMatch(/MAX_PAGES/);
    // 서킷 상한(700)이 아니라 MAX_PAGES(20)에서 끊겨야 한다
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(MAX_PAGES);
  });
});

describe("SEC-B2-04 — CORS 접미사 매칭이 레이블 경계를 지킨다", () => {
  async function originAllowed(origin: string): Promise<string | null> {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { header: { resultCode: "0000" }, body: { totalCount: 1, items: { item: [] } } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const res = await worker.fetch(
      new Request("https://proxy.example.com/api/proxy?operation=ldongCode2&numOfRows=3", {
        headers: { origin, "cf-connecting-ip": "7.7.7.7" },
      }),
      env
    );
    return res.headers.get("access-control-allow-origin");
  }

  it("★ 유사 호스트명을 거절한다 — 접두어만 다른 도메인은 남이다", async () => {
    // Pages 프로젝트명은 셀프서비스라 공격자가 실제로 등록할 수 있다.
    expect(await originAllowed("https://evilwhen-to-go-7s6.pages.dev")).toBeNull();
    expect(await originAllowed("https://xwhen-to-go-7s6.pages.dev")).toBeNull();
  });

  it("정상 apex와 프리뷰 서브도메인은 계속 허용한다", async () => {
    expect(await originAllowed("https://when-to-go-7s6.pages.dev")).toBe("https://when-to-go-7s6.pages.dev");
    expect(await originAllowed("https://abc123.when-to-go-7s6.pages.dev")).toBe("https://abc123.when-to-go-7s6.pages.dev");
  });

  it("접미사를 흉내낸 외부 도메인도 거절한다", async () => {
    expect(await originAllowed("https://when-to-go-7s6.pages.dev.evil.com")).toBeNull();
  });
});
