import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchRelatedTop5 } from "../worker/src/related";
import { resetCircuitForTests } from "../worker/src/circuit";
import { historyClearForTests } from "../worker/src/history";

const env = { TOURAPI_KEY: "FAKE_KEY", UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function upstream(items: unknown[], totalCount: number) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item: items }, numOfRows: 1000, pageNo: 1, totalCount } } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetCircuitForTests();
  historyClearForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

describe("fetchRelatedTop5", () => {
  it("★ 경기도 화성시처럼 연관 데이터가 없는 시군구는 empty:true를 반환한다 (하드코딩 아님, 실측 근거)", async () => {
    fetchSpy.mockResolvedValueOnce(upstream([], 0));
    const result = await fetchRelatedTop5("41", "41590", "202605", env);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.empty).toBe(true);
      expect(result.items).toHaveLength(0);
    }
  });

  it("데이터가 있는 시군구는 rlteRank 상위 5개만, rank 오름차순으로 반환한다", async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      rlteRank: String(i + 1),
      rlteTatsNm: `연관${i + 1}`,
      rlteCtgrySclsNm: "자연경관",
      rlteSignguNm: "경주시",
    }));
    fetchSpy.mockResolvedValueOnce(upstream(items, 8));
    const result = await fetchRelatedTop5("47", "47130", "202605", env);
    if (!("error" in result)) {
      expect(result.items).toHaveLength(5);
      expect(result.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(result.empty).toBe(false);
    }
  });

  it("upstream 실패는 error로 드러난다 (빈 목록으로 위장하지 않는다)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const result = await fetchRelatedTop5("41", "41590", "202605", env);
    expect("error" in result).toBe(true);
  });
});
