import { describe, it, expect } from "vitest";
import { variants, normalizeKey } from "../worker/src/normalize";

// M0 실측(2026-08-28)에서 발견한 결함의 회귀 테스트: 괄호 별칭 분해가
// 지역명을 단독 variant로 만들어 그 지역 이름이 든 모든 POI에 매칭되던 문제.
// 이 결함을 고치니 복수 후보 51건 -> 14건, 미연결률 21.96% -> 15.54%로 내려갔다.

describe("지역명 단독 variant 제외 (M0 결함 수정)", () => {
  it("★ '관덕정(제주)'의 variants에 지역명 단독 '제주'가 포함되지 않는다", () => {
    const result = variants("관덕정(제주)", "제주특별자치도", "제주시");
    expect(result.has(normalizeKey("제주"))).toBe(false);
    expect(result.has(normalizeKey("관덕정"))).toBe(true);
  });

  it("sido 전체명·2자 축약형·sigungu 전체명·'시/군/구' 제거형이 전부 제외된다", () => {
    const result = variants("아무거나(원주)", "강원특별자치도", "원주시");
    expect(result.has(normalizeKey("원주시"))).toBe(false);
    expect(result.has(normalizeKey("원주"))).toBe(false);
    expect(result.has(normalizeKey("강원특별자치도"))).toBe(false);
    expect(result.has(normalizeKey("강원"))).toBe(false);
  });

  it("지역명이 포함된 진짜 관광지명(지역명 접두사가 실제 이름의 일부)은 살아남는다", () => {
    // "원주 반계리 은행나무" -> 접두 "원주" 제거 후에도 "반계리은행나무"라는
    // 식별력 있는 variant가 남아야 한다.
    const result = variants("원주 반계리 은행나무", "강원특별자치도", "원주시");
    expect(result.has(normalizeKey("반계리은행나무"))).toBe(true);
  });
});

describe("6개 정규화 규칙", () => {
  it("1. 대괄호 제거", () => {
    const result = variants("거문오름 [세계자연유산]", "제주특별자치도", "제주시");
    expect(result.has(normalizeKey("거문오름"))).toBe(true);
  });

  it("2. 슬래시·가운뎃점 분해", () => {
    const result = variants("동쪽/서쪽·중앙", "강원특별자치도", "춘천시");
    expect(result.has(normalizeKey("동쪽"))).toBe(true);
    expect(result.has(normalizeKey("서쪽"))).toBe(true);
    expect(result.has(normalizeKey("중앙"))).toBe(true);
  });

  it("3. 괄호 제거본 + 괄호 안 콤마 별칭 분해", () => {
    const result = variants("거슨세미(세미오름, 샘오름)", "제주특별자치도", "제주시");
    expect(result.has(normalizeKey("거슨세미"))).toBe(true);
    expect(result.has(normalizeKey("세미오름"))).toBe(true);
    expect(result.has(normalizeKey("샘오름"))).toBe(true);
  });

  it("4. 지역명 접두·접미 제거", () => {
    const result = variants("경주 불국사", "경상북도", "경주시");
    expect(result.has(normalizeKey("불국사"))).toBe(true);
  });

  it("5. 시설 접미(폐역) 변형", () => {
    const result = variants("구둔역 폐역", "경기도", "양평군");
    expect(result.has(normalizeKey("구둔역"))).toBe(true);
  });

  it("6. 공백·기호 정규화 후 소문자", () => {
    expect(normalizeKey("A B-C_D~E,F.G'H\"I·J")).toBe("abcdefghij".toLowerCase());
  });
});

describe("2자 미만 후보 배제", () => {
  it("정규화 후 1자 이하인 variant는 후보에서 제외된다", () => {
    const result = variants("가", "강원특별자치도", "춘천시");
    expect(result.has("가")).toBe(false);
  });
});
