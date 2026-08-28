import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { collectTatsCnctrRatedList } from "../worker/src/collect";
import type { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";

// QA 레드팀 BLOCKER-2 회귀 테스트.
//
// 관광지 데이터가 진짜로 없는 시군구를 조회하면 `totalCount=0`이 온다. 이건 정상적인
// 빈 응답이지 수집 실패가 아니다. 그런데 windowExact가 `windowLength > 0`을 요구해서
// 항상 false가 됐고, 그 결과:
//   - complete=false → App.tsx의 `no-data` 분기가 **죽은 코드**가 되고
//   - 사용자는 "데이터 없음" 대신 "0 attraction(s) have row count != window length (0)"라는
//     내부 진단 문구를 빨간 오류 배너로 보게 된다.
//
// 실측 재현: 목포시 등 6개 시군구 + 강원 임의코드 32010.
// "실패를 감추지 마라"의 반대편 오류다 — **성공을 실패로 위조**하면 그것도 거짓말이다.

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

function upstream(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("빈 시군구는 오류가 아니라 빈 결과다", () => {
  it("totalCount=0, items 없음 → complete=true, 항목 0개", async () => {
    fetchSpy.mockResolvedValueOnce(
      upstream({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { totalCount: 0, numOfRows: 1000, pageNo: 1, items: "" } } })
    );
    const result = await collectTatsCnctrRatedList("52", "52110", env);
    expect(result.items).toHaveLength(0);
    expect(result.integrity.complete).toBe(true);
    expect(result.integrity.failureReason).toBeUndefined();
  });

  it("totalCount=0, items.item이 빈 배열이어도 동일하게 정상이다", async () => {
    fetchSpy.mockResolvedValueOnce(
      upstream({ response: { header: { resultCode: "0000" }, body: { totalCount: 0, items: { item: [] } } } })
    );
    const result = await collectTatsCnctrRatedList("52", "52110", env);
    expect(result.integrity.complete).toBe(true);
    expect(result.integrity.totalCount).toBe(0);
  });

  it("★ 빈 결과에 내부 진단 문구가 새어나오지 않는다", async () => {
    fetchSpy.mockResolvedValueOnce(
      upstream({ response: { header: { resultCode: "0000" }, body: { totalCount: 0, items: "" } } })
    );
    const result = await collectTatsCnctrRatedList("52", "52110", env);
    expect(result.integrity.failureReason ?? "").not.toMatch(/row count|window length|offending/i);
  });

  it("진짜 불완전(totalCount>0인데 행이 안 옴)은 여전히 실패로 잡는다", async () => {
    // 빈 응답을 정상 처리하려다 진짜 결함까지 통과시키면 안 된다.
    fetchSpy.mockResolvedValueOnce(
      upstream({ response: { header: { resultCode: "0000" }, body: { totalCount: 30, items: "" } } })
    );
    const result = await collectTatsCnctrRatedList("52", "52110", env);
    expect(result.integrity.complete).toBe(false);
    expect(String(result.integrity.failureReason)).toMatch(/totalCount is 30|!= totalCount/i);
  });

  it("정상 데이터가 있는 시군구는 영향 없다", async () => {
    const item = [
      { baseYmd: "20260828", areaCd: "51", areaNm: "강원", signguCd: "51110", signguNm: "춘천", tAtsNm: "A", cnctrRate: "44.9" },
      { baseYmd: "20260829", areaCd: "51", areaNm: "강원", signguCd: "51110", signguNm: "춘천", tAtsNm: "A", cnctrRate: "51.2" },
    ];
    fetchSpy.mockResolvedValueOnce(
      upstream({ response: { header: { resultCode: "0000" }, body: { totalCount: 2, items: { item } } } })
    );
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.complete).toBe(true);
    expect(result.integrity.windowLength).toBe(2);
    expect(result.items).toHaveLength(2);
  });
});
