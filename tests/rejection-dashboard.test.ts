import { describe, it, expect } from "vitest";
import { buildPoiIndex } from "../web/src/match";
import { computeRejectionDashboard, UNLINKED_RATE_WARN_THRESHOLD } from "../web/src/rejectionDashboard";
import type { PoiItem } from "../web/src/match";

function poi(overrides: Partial<PoiItem> = {}): PoiItem {
  return { contentid: "1", title: "테스트", addr1: "강원특별자치도 춘천시", mapx: "1", mapy: "1", ...overrides };
}

describe("런타임 미연결률 계기판 — 실계측, 표본 추정 아님", () => {
  it("전부 성공하면 미연결률 0%", () => {
    const poiList = [
      poi({ contentid: "1", title: "남이섬", addr1: "강원특별자치도 춘천시" }),
      poi({ contentid: "2", title: "소양강댐", addr1: "강원특별자치도 춘천시" }),
    ];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const dashboard = computeRejectionDashboard(["남이섬", "소양강댐"], index, "강원특별자치도", "춘천시");
    expect(dashboard.unlinkedRatePercent).toBe(0);
    expect(dashboard.warn).toBe(false);
    expect(dashboard.singleMatch).toBe(2);
  });

  it("25% 초과 시 경고(R3 트리거) — M0 임계값과 동일", () => {
    // 4곳 중 2곳이 거절(0개 후보)되면 50% -> 경고
    const poiList = [poi({ contentid: "1", title: "실존", addr1: "강원특별자치도 춘천시" })];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const names = ["실존", "미존재1", "미존재2", "미존재3"];
    const dashboard = computeRejectionDashboard(names, index, "강원특별자치도", "춘천시");
    expect(dashboard.unlinkedRatePercent).toBe(75);
    expect(dashboard.warn).toBe(true);
    expect(UNLINKED_RATE_WARN_THRESHOLD).toBe(25);
  });

  it("정확히 임계값(25%)이면 경고하지 않는다 — 초과만 트리거", () => {
    const poiList = [
      poi({ contentid: "1", title: "가나다", addr1: "강원특별자치도 춘천시" }),
      poi({ contentid: "2", title: "라마바", addr1: "강원특별자치도 춘천시" }),
      poi({ contentid: "3", title: "사아자", addr1: "강원특별자치도 춘천시" }),
    ];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const names = ["가나다", "라마바", "사아자", "미존재"]; // 1/4 = 25%
    const dashboard = computeRejectionDashboard(names, index, "강원특별자치도", "춘천시");
    expect(dashboard.unlinkedRatePercent).toBe(25);
    expect(dashboard.warn).toBe(false);
  });

  it("0개·복수·주소불일치를 모두 미연결로 합산한다", () => {
    const poiList = [
      poi({ contentid: "1", title: "복수후보(별칭1)" }),
      poi({ contentid: "2", title: "복수후보(별칭2)" }),
      poi({ contentid: "3", title: "주소불일치", addr1: "서울특별시 종로구" }),
    ];
    const index = buildPoiIndex(poiList, "강원특별자치도", "춘천시");
    const names = ["복수후보", "주소불일치", "완전미존재"];
    const dashboard = computeRejectionDashboard(names, index, "강원특별자치도", "춘천시");
    expect(dashboard.multiple).toBe(1);
    expect(dashboard.addressMismatch).toBe(1);
    expect(dashboard.zero).toBe(1);
    expect(dashboard.unlinkedCount).toBe(3);
    expect(dashboard.unlinkedRatePercent).toBe(100);
  });
});
