import { describe, it, expect } from "vitest";
import { buildPoiIndex, resolveAttraction } from "../worker/src/match";
import type { PoiItem } from "../worker/src/poi";

function poi(overrides: Partial<PoiItem> = {}): PoiItem {
  return { contentid: "1", title: "테스트POI", addr1: "강원특별자치도 춘천시 어딘가", mapx: "1", mapy: "1", ...overrides };
}

describe("resolveAttraction — 4경로", () => {
  it("후보 0개 -> zero_candidates", () => {
    const index = buildPoiIndex([poi({ title: "전혀 다른 이름" })], "강원특별자치도", "춘천시");
    const outcome = resolveAttraction("남이섬", index, "강원특별자치도", "춘천시");
    expect(outcome.kind).toBe("zero_candidates");
  });

  it("후보 복수 N개 -> multiple_candidates, 추측 매핑을 만들지 않는다", () => {
    // 둘 다 괄호 제거 규칙으로 정확히 "남이섬"으로 정규화되는 서로 다른 POI 두 개
    // (동명이지만 contentId가 다른 실제 모호성 상황을 재현).
    const poiList = [
      poi({ contentid: "10", title: "남이섬(본섬)" }),
      poi({ contentid: "11", title: "남이섬(매표소)" }),
    ];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const outcome = resolveAttraction("남이섬", index, "강원특별자치도", "춘천시");
    expect(outcome.kind).toBe("multiple_candidates");
    if (outcome.kind === "multiple_candidates") {
      expect(outcome.candidates).toHaveLength(2);
    }
  });

  it("주소 불일치 -> address_mismatch (addr1에 대상 시군구명 없음)", () => {
    const poiList = [poi({ contentid: "20", title: "남이섬", addr1: "서울특별시 종로구 어딘가" })];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const outcome = resolveAttraction("남이섬", index, "강원특별자치도", "춘천시");
    expect(outcome.kind).toBe("address_mismatch");
  });

  it("빈 addr1도 불일치로 센다", () => {
    const poiList = [poi({ contentid: "21", title: "남이섬", addr1: "" })];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const outcome = resolveAttraction("남이섬", index, "강원특별자치도", "춘천시");
    expect(outcome.kind).toBe("address_mismatch");
  });

  it("단일 후보 -> single_match", () => {
    const poiList = [poi({ contentid: "30", title: "남이섬", addr1: "강원특별자치도 춘천시 남산면" })];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const outcome = resolveAttraction("남이섬", index, "강원특별자치도", "춘천시");
    expect(outcome.kind).toBe("single_match");
    if (outcome.kind === "single_match") {
      expect(outcome.poi.contentid).toBe("30");
    }
  });

  it("괄호 별칭으로 연결된 이름도 단일 매칭된다", () => {
    const poiList = [poi({ contentid: "40", title: "거슨세미", addr1: "제주특별자치도 제주시 조천읍" })];
    const index = buildPoiIndex(poiList, "제주특별자치도", "제주시");
    const outcome = resolveAttraction("거슨세미(세미오름, 샘오름)", index, "제주특별자치도", "제주시");
    expect(outcome.kind).toBe("single_match");
  });

  it("동일 POI가 여러 variant로 중복 매칭돼도 후보는 1건으로 dedupe된다", () => {
    const poiList = [poi({ contentid: "50", title: "구둔역 폐역", addr1: "경기도 양평군 지평면" })];
    const index = buildPoiIndex(poiList, "경기도", "양평군");
    const outcome = resolveAttraction("구둔역", index, "경기도", "양평군");
    expect(outcome.kind).toBe("single_match");
  });
});
