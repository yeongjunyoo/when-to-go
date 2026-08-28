import { describe, it, expect } from "vitest";
import { isSejong, normalizeRegnCd, toSignguCd, toAreaCd, SEJONG_LDONG_CODE, RegionCodeError } from "../worker/src/region-codes";

// 이 스위트가 존재하는 이유:
// B1 최초 구현은 세종의 `lDongRegnCd`가 "36"이라고 가정했고, 유닛 테스트도 "36"을
// 직접 넣어 통과했다. 그러나 배포본에서 `ldongCode2`를 실호출해보니 시도 목록 16건 중
// **세종만 `code="36110"`(5자리)로 내려온다.** 결과적으로 배포된 서비스에서 세종을 누르면
// terminal node 판정이 실패해 "2. 시군구 선택"이 렌더되고
// `"lDongRegnCd" must be exactly 2 digits` 오류가 화면에 떴다.
//
// 즉 가정이 아니라 **응답의 실제 모양**을 계약으로 고정해야 한다.
// 아래 값들은 2026-08-28 배포본 실호출로 관측한 것이다.

const OBSERVED_SIDO_CODES = [
  "11", // 서울특별시
  "12", // 전남광주통합특별시
  "26", // 부산광역시
  "27", // 대구광역시
  "28", // 인천광역시
  "30", // 대전광역시
  "31", // 울산광역시
  "41", // 경기도
  "43", // 충청북도
  "44", // 충청남도
  "47", // 경상북도
  "48", // 경상남도
  "50", // 제주특별자치도
  "51", // 강원특별자치도
  "52", // 전북특별자치도
  "36110", // 세종특별자치시 ← 유일한 5자리
];

describe("실측된 ldongCode2 시도 코드 모양", () => {
  it("세종만 5자리이고 나머지는 전부 2자리다", () => {
    const fiveDigit = OBSERVED_SIDO_CODES.filter((c) => c.length === 5);
    expect(fiveDigit).toEqual([SEJONG_LDONG_CODE]);
    expect(OBSERVED_SIDO_CODES.filter((c) => c.length === 2)).toHaveLength(15);
  });

  it("시도 목록의 모든 코드가 정규화를 통과한다 (배포 시 오류가 나지 않는다)", () => {
    for (const code of OBSERVED_SIDO_CODES) {
      expect(() => normalizeRegnCd(code)).not.toThrow();
      expect(normalizeRegnCd(code)).toHaveLength(2);
    }
  });

  it("세종을 응답 원본 코드(36110)로 판정한다 — 이것이 실제 결함이었다", () => {
    expect(isSejong("36110")).toBe(true);
  });

  it("정규화된 2자리 세종 코드도 계속 인정한다", () => {
    expect(isSejong("36")).toBe(true);
  });

  it("세종이 아닌 시도는 terminal node가 아니다", () => {
    for (const code of OBSERVED_SIDO_CODES.filter((c) => c !== SEJONG_LDONG_CODE)) {
      expect(isSejong(code)).toBe(false);
    }
  });

  it("세종 원본 코드를 정규화하면 areaCd 2자리 계약을 만족한다", () => {
    const normalized = normalizeRegnCd(SEJONG_LDONG_CODE);
    expect(normalized).toBe("36");
    expect(() => toAreaCd(normalized)).not.toThrow();
    expect(toAreaCd(normalized)).toBe("36");
  });

  it("세종 signguCd는 36110으로 복원된다 (정규화 후 재조합해도 동일)", () => {
    expect(toSignguCd(normalizeRegnCd(SEJONG_LDONG_CODE), "110")).toBe("36110");
  });

  it("예상 밖 자릿수는 조용히 통과시키지 않고 거절한다", () => {
    expect(() => normalizeRegnCd("3")).toThrow(RegionCodeError);
    expect(() => normalizeRegnCd("361")).toThrow(RegionCodeError);
    expect(() => normalizeRegnCd("3611")).toThrow(RegionCodeError);
    expect(() => normalizeRegnCd("361100")).toThrow(RegionCodeError);
    expect(() => normalizeRegnCd("")).toThrow(RegionCodeError);
  });

  it("정규화는 문자열 절단이지 수치 연산이 아니다 (선행 0 보존)", () => {
    expect(normalizeRegnCd("01")).toBe("01");
    expect(normalizeRegnCd("01010")).toBe("01");
  });
});
