import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPoiIndex, resolveAttraction, type PoiItem } from "../web/src/match";
import { buildIndexData, loadIndexFromData } from "../web/src/indexBuilder";

// G5 게이트: "인덱스 삭제 시 전 기능 정상 동작"의 순수 로직 증거.
// getPoiIndexFor() 자체는 fetch()를 호출하는 async 브라우저 코드라 e2e
// 환경 없이는 직접 실행하기 까다롭지만, 그 함수가 기대는 두 개의 순수 계약
// — (a) loadIndexFromData가 커버리지 없는 인덱스에서 null을 반환한다,
// (b) 그 null을 받은 뒤 buildPoiIndex(liveItems, ...)로 정상 폴백해도
// resolveAttraction 결과가 완전히 동일하다 — 을 여기서 기계적으로 증명한다.

describe("B-index 부재/미커버 시 B-live로 폴백 — 기능 손실 없음", () => {
  const SIGUNGU = { lDongRegnCd: "51", lDongSignguCd: "110", sidoName: "강원특별자치도", signguName: "춘천시" };

  function poi(overrides: Partial<PoiItem> = {}): PoiItem {
    return { contentid: "1", title: "남이섬", addr1: "강원특별자치도 춘천시", mapx: "1", mapy: "1", ...overrides };
  }

  it("빈 인덱스 페이로드(entries: [])는 어떤 시군구도 커버하지 않는다 — null 반환, 예외 없음", () => {
    const emptyData = buildIndexData([], false);
    const loaded = loadIndexFromData(emptyData, SIGUNGU.lDongRegnCd, SIGUNGU.lDongSignguCd);
    expect(loaded).toBeNull();
  });

  it("실제 리포에 커밋된 플레이스홀더(web/src/generated/poi-index.generated.json)도 빈 entries다", async () => {
    const placeholder = (await import("../web/src/generated/poi-index.generated.json")) as unknown as { default: { entries: unknown[] } };
    expect(placeholder.default.entries).toEqual([]);
  });

  it("인덱스가 이 시군구를 커버하지 않을 때, B-live 경로(buildPoiIndex 직접 호출)로 폴백한 결과가 인덱스가 애초에 있었을 때와 동일하다", () => {
    const pois = [poi()];

    // "인덱스 없음" 시나리오: 곧바로 B-live 경로로 간다.
    const fallbackIndex = buildPoiIndex(pois, SIGUNGU.sidoName, SIGUNGU.signguName);
    const fallbackOutcome = resolveAttraction("남이섬", fallbackIndex, SIGUNGU.sidoName, SIGUNGU.signguName);

    // "인덱스 있었다면" 시나리오: 동일 POI 배열을 인덱스로 포장했다가 복원.
    const entry = { lDongRegnCd: SIGUNGU.lDongRegnCd, lDongSignguCd: SIGUNGU.lDongSignguCd, sidoName: SIGUNGU.sidoName, signguName: SIGUNGU.signguName, pois };
    const indexData = buildIndexData([entry], false);
    const loaded = loadIndexFromData(indexData, SIGUNGU.lDongRegnCd, SIGUNGU.lDongSignguCd)!;
    const indexOutcome = resolveAttraction("남이섬", loaded.index, SIGUNGU.sidoName, SIGUNGU.signguName);

    expect(fallbackOutcome).toEqual(indexOutcome);
  });

  it("4경로 전부에서 폴백 결과와 인덱스 결과가 일치한다 (zero/multiple/address_mismatch/single_match)", () => {
    const scenarios: { name: string; pois: PoiItem[] }[] = [
      { name: "무존재", pois: [poi({ contentid: "x", title: "다른이름" })] },
      { name: "복수", pois: [poi({ contentid: "a", title: "복수(별칭1)" }), poi({ contentid: "b", title: "복수(별칭2)" })] },
      { name: "주소불일치", pois: [poi({ contentid: "c", title: "주소불일치", addr1: "제주특별자치도 제주시" })] },
      { name: "정상", pois: [poi({ contentid: "d", title: "정상" })] },
    ];

    for (const scenario of scenarios) {
      const fallbackIndex = buildPoiIndex(scenario.pois, SIGUNGU.sidoName, SIGUNGU.signguName);
      const fallbackOutcome = resolveAttraction(scenario.name, fallbackIndex, SIGUNGU.sidoName, SIGUNGU.signguName);

      const entry = { lDongRegnCd: SIGUNGU.lDongRegnCd, lDongSignguCd: SIGUNGU.lDongSignguCd, sidoName: SIGUNGU.sidoName, signguName: SIGUNGU.signguName, pois: scenario.pois };
      const indexData = buildIndexData([entry], false);
      const loaded = loadIndexFromData(indexData, SIGUNGU.lDongRegnCd, SIGUNGU.lDongSignguCd)!;
      const indexOutcome = resolveAttraction(scenario.name, loaded.index, SIGUNGU.sidoName, SIGUNGU.signguName);

      expect(indexOutcome, `mismatch for scenario "${scenario.name}"`).toEqual(fallbackOutcome);
    }
  });
});

describe("LOCAL_STORAGE_APPROVED 플래그 — 승인 여부와 무관하게 판정 가능", () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
  });

  it("플래그가 'true'가 아닌 모든 값에서 off로 판정된다", async () => {
    for (const value of [undefined, "false", "1", "TRUE", ""]) {
      vi.stubEnv("VITE_LOCAL_STORAGE_APPROVED", value as string);
      vi.resetModules();
      const mod = await import("../web/src/localStorageApproval");
      expect(mod.LOCAL_STORAGE_APPROVED, `value=${JSON.stringify(value)} should be off`).toBe(false);
      vi.unstubAllEnvs();
    }
  });

  it("정확히 'true' 문자열일 때만 on으로 판정된다", async () => {
    vi.stubEnv("VITE_LOCAL_STORAGE_APPROVED", "true");
    vi.resetModules();
    const mod = await import("../web/src/localStorageApproval");
    expect(mod.LOCAL_STORAGE_APPROVED).toBe(true);
    vi.unstubAllEnvs();
  });
});
