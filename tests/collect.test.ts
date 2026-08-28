import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectTatsCnctrRatedList, PAGE_SIZE, TatsCnctrItem } from "../worker/src/collect";
import { resetCircuitForTests } from "../worker/src/circuit";
import { historyClearForTests } from "../worker/src/history";

const env = { TOURAPI_KEY: "FAKE_KEY", UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function item(tAtsNm: string, baseYmd: string, extra: Partial<TatsCnctrItem> = {}): TatsCnctrItem {
  return {
    baseYmd,
    areaCd: "51",
    areaNm: "강원",
    signguCd: "51110",
    signguNm: "춘천시",
    tAtsNm,
    cnctrRate: 50,
    ...extra,
  };
}

function upstreamResponse(items: TatsCnctrItem[], totalCount: number) {
  return new Response(
    JSON.stringify({
      response: {
        header: { resultCode: "0000", resultMsg: "OK" },
        body: { items: { item: items }, numOfRows: PAGE_SIZE, pageNo: 1, totalCount },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCircuitForTests();
  historyClearForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// A clean 2-attraction x 2-date dataset that satisfies all 4 invariants —
// the reference "happy path" every violation test below is a mutation of.
function happyPathItems(): TatsCnctrItem[] {
  return [
    item("남이섬", "20260828"),
    item("소양강댐", "20260828"),
    item("남이섬", "20260829"),
    item("소양강댐", "20260829"),
  ];
}

describe("collectTatsCnctrRatedList — happy path", () => {
  it("marks a well-formed single-page collection complete and passes all 4 invariants", async () => {
    fetchSpy.mockResolvedValueOnce(upstreamResponse(happyPathItems(), 4));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.complete).toBe(true);
    expect(result.integrity.stableTotal).toBe(true);
    expect(result.integrity.rawExact).toBe(true);
    expect(result.integrity.uniqueExact).toBe(true);
    expect(result.integrity.windowExact).toBe(true);
    expect(result.integrity.totalCount).toBe(4);
    expect(result.integrity.rawFetched).toBe(4);
    expect(result.integrity.uniqueFetched).toBe(4);
    expect(result.integrity.windowLength).toBe(2);
    expect(result.items).toHaveLength(4);
  });

  it("paginates across multiple upstream pages fixed at 1000 rows each", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => item(`attr${i}`, "20260828"));
    const page2 = Array.from({ length: 200 }, (_, i) => item(`attr${i}`, "20260829")).slice(0, 200);
    // second page must reuse the SAME attraction names to satisfy window invariant (2-date window)
    const page2Same = Array.from({ length: PAGE_SIZE }, (_, i) => item(`attr${i}`, "20260829"));
    fetchSpy.mockResolvedValueOnce(upstreamResponse(page1, 2000)).mockResolvedValueOnce(upstreamResponse(page2Same, 2000));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.integrity.pages).toBe(2);
    expect(result.integrity.complete).toBe(true);
    expect(result.integrity.rawFetched).toBe(2000);
    void page2;
  });
});

describe("collectTatsCnctrRatedList — invariant violations (4 kinds, each individually)", () => {
  it("1. stableTotal violation: totalCount differs across pages -> incomplete", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => item(`attr${i}`, "20260828"));
    const page2 = Array.from({ length: PAGE_SIZE }, (_, i) => item(`attr${i}`, "20260829"));
    fetchSpy.mockResolvedValueOnce(upstreamResponse(page1, 2000)).mockResolvedValueOnce(upstreamResponse(page2, 1999));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.complete).toBe(false);
    expect(result.integrity.stableTotal).toBe(false);
    expect(result.integrity.failureReason).toMatch(/totalCount unstable/);
  });

  it("2. rawExact violation: totalCount says 6 but upstream only returns 4 rows -> incomplete", async () => {
    fetchSpy.mockResolvedValueOnce(upstreamResponse(happyPathItems(), 6));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.complete).toBe(false);
    expect(result.integrity.rawExact).toBe(false);
    expect(result.integrity.rawFetched).toBe(4);
    expect(result.integrity.totalCount).toBe(6);
    expect(result.integrity.failureReason).toMatch(/rawFetched/);
  });

  it("3. uniqueExact violation: (tAtsNm, baseYmd) key collision silently shrinks unique count -> incomplete, NOT reported as success", async () => {
    // 4 raw rows claimed by totalCount=4, but two rows collide on the same
    // (tAtsNm, baseYmd) key (duplicate delivery from upstream), so after
    // dedup only 3 unique rows remain even though rawFetched == totalCount.
    const items = [
      item("남이섬", "20260828"),
      item("남이섬", "20260828"), // collides with the row above
      item("남이섬", "20260829"),
      item("소양강댐", "20260829"),
    ];
    fetchSpy.mockResolvedValueOnce(upstreamResponse(items, 4));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.rawExact).toBe(true); // raw count matches totalCount...
    expect(result.integrity.uniqueExact).toBe(false); // ...but dedup reveals the collision
    expect(result.integrity.uniqueFetched).toBe(3);
    expect(result.integrity.complete).toBe(false); // must NOT be marked successful
    expect(result.integrity.failureReason).toMatch(/key collision/);
  });

  it("4. windowExact violation: an attraction is missing a row for one date in the window -> incomplete", async () => {
    const items = [
      item("남이섬", "20260828"),
      item("남이섬", "20260829"),
      item("소양강댐", "20260828"),
      // 소양강댐 is missing its 20260829 row — window length is 2 but this
      // attraction only has 1 row.
    ];
    fetchSpy.mockResolvedValueOnce(upstreamResponse(items, 3));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.stableTotal).toBe(true);
    expect(result.integrity.rawExact).toBe(true);
    expect(result.integrity.uniqueExact).toBe(true);
    expect(result.integrity.windowExact).toBe(false);
    expect(result.integrity.offendingAttractions).toContain("소양강댐");
    expect(result.integrity.complete).toBe(false);
    expect(result.integrity.failureReason).toMatch(/window length/);
  });
});

describe("collectTatsCnctrRatedList — upstream failure mid-pagination", () => {
  it("surfaces failure (not partial-as-success) when a later page fails", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => item(`attr${i}`, "20260828"));
    fetchSpy.mockResolvedValueOnce(upstreamResponse(page1, 2000)).mockRejectedValueOnce(new Error("network down"));
    const result = await collectTatsCnctrRatedList("51", "51110", env);
    expect(result.integrity.complete).toBe(false);
    expect(result.integrity.failureReason).toMatch(/page 2 failed/);
  });
});
