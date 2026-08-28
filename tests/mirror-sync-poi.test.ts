import { describe, it, expect } from "vitest";
import * as workerNormalize from "../worker/src/normalize";
import * as webNormalize from "../web/src/normalize";
import { buildPoiIndex as workerBuildIndex, resolveAttraction as workerResolve } from "../worker/src/match";
import { buildPoiIndex as webBuildIndex, resolveAttraction as webResolve } from "../web/src/match";
import type { PoiItem as WorkerPoiItem } from "../worker/src/poi";
import type { PoiItem as WebPoiItem } from "../web/src/match";

// normalize.ts와 match.ts는 web/worker 양쪽에 수동 미러로 존재한다(공유 패키지
// 없음). 세종 결함과 동일한 구조의 드리프트가 여기서도 날 수 있다 — 기계적으로 고정한다.

describe("worker/web normalize.ts 미러 동기화", () => {
  it("variants()가 동일한 입력에 동일한 결과를 낸다", () => {
    const cases: Array<[string, string, string]> = [
      ["관덕정(제주)", "제주특별자치도", "제주시"],
      ["거슨세미(세미오름, 샘오름)", "제주특별자치도", "제주시"],
      ["구둔역 폐역", "경기도", "양평군"],
      ["거문오름 [세계자연유산]", "제주특별자치도", "제주시"],
      ["동쪽/서쪽·중앙", "강원특별자치도", "춘천시"],
    ];
    for (const [name, sido, sggu] of cases) {
      const workerResult = [...workerNormalize.variants(name, sido, sggu)].sort();
      const webResult = [...webNormalize.variants(name, sido, sggu)].sort();
      expect(webResult, `variants(${name}) drifted`).toEqual(workerResult);
    }
  });

  it("normalizeKey가 동일한 입력에 동일한 값을 낸다", () => {
    for (const input of ["A B-C_D~E,F.G'H\"I·J", "관덕정(제주)", "", "  "]) {
      expect(webNormalize.normalizeKey(input)).toBe(workerNormalize.normalizeKey(input));
    }
  });
});

describe("worker/web match.ts 미러 동기화", () => {
  function poi(overrides: Partial<WorkerPoiItem> = {}): WorkerPoiItem & WebPoiItem {
    return { contentid: "1", title: "테스트", addr1: "강원특별자치도 춘천시", mapx: "1", mapy: "1", ...overrides };
  }

  it("resolveAttraction이 동일한 입력에 동일한 kind를 낸다 (4경로 전부)", () => {
    const cases: Array<{ poiList: WorkerPoiItem[]; name: string }> = [
      { poiList: [poi({ title: "전혀 다른 이름" })], name: "남이섬" }, // zero
      { poiList: [poi({ contentid: "1", title: "남이섬(A)" }), poi({ contentid: "2", title: "남이섬(B)" })], name: "남이섬" }, // multiple
      { poiList: [poi({ title: "남이섬", addr1: "서울특별시 종로구" })], name: "남이섬" }, // address_mismatch
      { poiList: [poi({ title: "남이섬", addr1: "강원특별자치도 춘천시 남산면" })], name: "남이섬" }, // single_match
    ];
    for (const { poiList, name } of cases) {
      const workerIndex = workerBuildIndex(poiList, "강원특별자치도", "춘천시");
      const webIndex = webBuildIndex(poiList as WebPoiItem[], "강원특별자치도", "춘천시");
      const workerOutcome = workerResolve(name, workerIndex, "강원특별자치도", "춘천시");
      const webOutcome = webResolve(name, webIndex, "강원특별자치도", "춘천시");
      expect(webOutcome.kind, `resolveAttraction(${name}) drifted`).toBe(workerOutcome.kind);
    }
  });
});
