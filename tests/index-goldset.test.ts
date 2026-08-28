import { describe, it, expect } from "vitest";
import { buildPoiIndex, resolveAttraction, type PoiItem } from "../web/src/match";
import { buildIndexEntry, buildIndexData, loadIndexFromData } from "../web/src/indexBuilder";

// ★ G5 게이트 요건: 합성 골드셋 60건에서 B-live 모드(직접 buildPoiIndex)와
// B-index 모드(loadIndexFromData 경유)가 정확히 동일한 결과를 낸다. 이 diff=0을
// 승인 여부와 무관하게 지금 증명할 수 있는 이유는, 두 모드 모두 결국 같은
// resolveAttraction()/buildPoiIndex()를 호출하기 때문이다 — 차이는 POI 배열의
// 출처(라이브 fetch vs 사전 직렬화)뿐이고, 그 출처 차이는 이 테스트가 순수하게
// 합성 데이터로 시뮬레이션한다(실호출 없음).

const SIGUNGU = { lDongRegnCd: "51", lDongSignguCd: "110", sidoName: "강원특별자치도", signguName: "춘천시" };

function poi(overrides: Partial<PoiItem> = {}): PoiItem {
  return { contentid: "1", title: "테스트", addr1: `${SIGUNGU.sidoName} ${SIGUNGU.signguName}`, mapx: "1", mapy: "1", ...overrides };
}

// 60건 합성 골드셋: 4경로(zero/multiple/address_mismatch/single_match)가 골고루
// 섞이도록 15건씩 4가지 패턴으로 구성한다.
function buildGoldset(): { attractionName: string; poiList: PoiItem[] }[] {
  const goldset: { attractionName: string; poiList: PoiItem[] }[] = [];

  for (let i = 0; i < 15; i++) {
    // zero_candidates: POI 풀에 이 이름과 매칭되는 후보가 전혀 없다.
    goldset.push({ attractionName: `미존재관광지${i}`, poiList: [poi({ contentid: `z${i}`, title: `무관한이름${i}` })] });
  }
  for (let i = 0; i < 15; i++) {
    // multiple_candidates: 동일 정규화 키로 매칭되는 POI 2개.
    goldset.push({
      attractionName: `복수후보${i}`,
      poiList: [poi({ contentid: `m${i}a`, title: `복수후보${i}(별칭A)` }), poi({ contentid: `m${i}b`, title: `복수후보${i}(별칭B)` })],
    });
  }
  for (let i = 0; i < 15; i++) {
    // address_mismatch: 단일 후보지만 addr1이 대상 시군구를 포함하지 않는다.
    goldset.push({ attractionName: `주소불일치${i}`, poiList: [poi({ contentid: `a${i}`, title: `주소불일치${i}`, addr1: "서울특별시 종로구" })] });
  }
  for (let i = 0; i < 15; i++) {
    // single_match: 단일 후보, 시군구 addr1 일치.
    goldset.push({ attractionName: `정상매칭${i}`, poiList: [poi({ contentid: `s${i}`, title: `정상매칭${i}` })] });
  }

  return goldset;
}

describe("B-live vs B-index — 합성 골드셋 60건 diff 0", () => {
  const goldset = buildGoldset();

  it("골드셋 크기가 정확히 60건이다", () => {
    expect(goldset).toHaveLength(60);
  });

  it("모든 60건에서 두 모드의 resolveAttraction 결과가 완전히 동일하다 (kind + 후보 개수)", () => {
    // 전체 POI 풀을 하나로 합쳐(실제 collectPoiIndex가 시군구 전체를 반환하는 것과
    // 동일하게) 두 모드가 같은 인덱스 조건에서 비교되도록 한다.
    const allPois = goldset.flatMap((g) => g.poiList);

    // B-live 모드: 라이브 /api/poi에서 막 받은 배열을 곧장 buildPoiIndex에 넣는 경로.
    const liveIndex = buildPoiIndex(allPois, SIGUNGU.sidoName, SIGUNGU.signguName);

    // B-index 모드: 동일한 POI 배열을 미리 직렬화된 인덱스 페이로드로 포장한 뒤
    // loadIndexFromData()로 복원 — 실제 생성기가 만드는 산출물 형태를 그대로 재현.
    const entry = buildIndexEntry(SIGUNGU.lDongRegnCd, SIGUNGU.lDongSignguCd, SIGUNGU.sidoName, SIGUNGU.signguName, allPois);
    const indexData = buildIndexData([entry], false); // markReal=false: 테스트 데이터, 실데이터 마커 없음
    const loaded = loadIndexFromData(indexData, SIGUNGU.lDongRegnCd, SIGUNGU.lDongSignguCd);
    expect(loaded).not.toBeNull();
    const indexModeIndex = loaded!.index;

    let diffs = 0;
    for (const { attractionName } of goldset) {
      const liveOutcome = resolveAttraction(attractionName, liveIndex, SIGUNGU.sidoName, SIGUNGU.signguName);
      const indexOutcome = resolveAttraction(attractionName, indexModeIndex, SIGUNGU.sidoName, SIGUNGU.signguName);

      if (liveOutcome.kind !== indexOutcome.kind) {
        diffs += 1;
        continue;
      }
      if (liveOutcome.kind === "multiple_candidates" && indexOutcome.kind === "multiple_candidates") {
        if (liveOutcome.candidates.length !== indexOutcome.candidates.length) diffs += 1;
      }
      if (liveOutcome.kind === "single_match" && indexOutcome.kind === "single_match") {
        if (liveOutcome.poi.contentid !== indexOutcome.poi.contentid) diffs += 1;
      }
    }

    expect(diffs).toBe(0);
  });

  it("각 경로(zero/multiple/address_mismatch/single_match)가 골드셋에 15건씩 실재한다 (테스트 자체의 커버리지 확인)", () => {
    const allPois = goldset.flatMap((g) => g.poiList);
    const index = buildPoiIndex(allPois, SIGUNGU.sidoName, SIGUNGU.signguName);
    const counts = { zero_candidates: 0, multiple_candidates: 0, address_mismatch: 0, single_match: 0 };
    for (const { attractionName } of goldset) {
      const outcome = resolveAttraction(attractionName, index, SIGUNGU.sidoName, SIGUNGU.signguName);
      counts[outcome.kind] += 1;
    }
    expect(counts.zero_candidates).toBe(15);
    expect(counts.multiple_candidates).toBe(15);
    expect(counts.address_mismatch).toBe(15);
    expect(counts.single_match).toBe(15);
  });
});
