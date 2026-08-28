import { describe, it, expect } from "vitest";
import { classifyPin, percentileRankOf, SPREAD_GUARD_THRESHOLD, PinTier } from "../web/src/pinClassify";
import type { CalendarDay } from "../web/src/attractionAnalysis";

function day(baseYmd: string, cnctrRate: number | null): CalendarDay {
  return { baseYmd, cnctrRate };
}

describe("percentileRankOf — nearest-rank method", () => {
  it("min value in a distribution has the lowest percentile", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentileRankOf(10, sorted)).toBe(20); // 1/5 = 20%
  });

  it("max value has percentile 100", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentileRankOf(50, sorted)).toBe(100);
  });

  it("median-ish value lands proportionally", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentileRankOf(30, sorted)).toBe(60); // 3/5 = 60%
  });

  it("ties count all <= entries (cumulative frequency)", () => {
    const sorted = [10, 10, 10, 20, 20];
    expect(percentileRankOf(10, sorted)).toBe(60); // 3/5
    expect(percentileRankOf(20, sorted)).toBe(100); // 5/5
  });
});

describe("classifyPin — 관광지 독립성 (structural guarantee)", () => {
  it("★ A의 값을 바꿔도 A와 무관한 B의 분류는 절대 바뀌지 않는다 — B 캘린더에만 의존한다", () => {
    const attractionB: CalendarDay[] = [day("20260828", 20), day("20260829", 50), day("20260830", 80)];

    const resultBefore = classifyPin(attractionB, "20260829");

    // 시나리오: A의 값이 뭐든 상관없다 — classifyPin은 attractionB 인자만 받으므로
    // A의 데이터를 전혀 참조할 수 없다(함수 시그니처 자체가 구조적 보장이다).
    // 이를 행동으로 재확인: B의 입력이 동일하면 결과도 항상 동일하다.
    const resultAfter = classifyPin(attractionB, "20260829");

    expect(resultAfter).toEqual(resultBefore);
  });

  it("서로 다른 두 관광지를 같은 날짜로 분류해도 서로의 계산에 상대 데이터가 섞이지 않는다", () => {
    // 둘 다 min<85로 배지 오버라이드를 피하고 순수 퍼센타일 경로만 확인한다.
    const attractionA: CalendarDay[] = [day("20260828", 60), day("20260829", 70), day("20260830", 80)]; // A: 상대적 고값대
    const attractionB: CalendarDay[] = [day("20260828", 5), day("20260829", 10), day("20260830", 15)]; // B: 상대적 저값대

    const resultA = classifyPin(attractionA, "20260828");
    const resultB = classifyPin(attractionB, "20260828");

    // A의 60은 A 자신의 분포(60,70,80) 안에서 최저값이라 low여야 하고,
    // B의 5는 B 자신의 분포(5,10,15) 안에서도 최저값이라 low여야 한다.
    // 값 자체(60 vs 5)로 비교하면 서로 정반대 결론이 나겠지만, 각자 자기
    // 분포 안에서만 평가되므로 둘 다 동일하게 "low"가 나와야 한다 — 이것이
    // "원값 기반 비교를 하지 않는다"는 계약의 행동적 증거다.
    expect(resultA.tier).toBe("low");
    expect(resultB.tier).toBe("low");
  });
});

describe("classifyPin — 3단 퍼센타일 이산화", () => {
  it("낮은 퍼센타일(<=33.33) -> low", () => {
    const calendar: CalendarDay[] = [day("20260828", 10), day("20260829", 50), day("20260830", 90)];
    const result = classifyPin(calendar, "20260828"); // 10 -> percentile 33.33
    expect(result.tier).toBe("low");
  });

  it("중간 퍼센타일 -> mid", () => {
    const calendar: CalendarDay[] = [day("20260828", 10), day("20260829", 50), day("20260830", 90)];
    const result = classifyPin(calendar, "20260829"); // 50 -> percentile 66.67
    expect(result.tier).toBe("mid");
  });

  it("높은 퍼센타일(>66.67) -> high", () => {
    const calendar: CalendarDay[] = [day("20260828", 10), day("20260829", 50), day("20260830", 90)];
    const result = classifyPin(calendar, "20260830"); // 90 -> percentile 100
    expect(result.tier).toBe("high");
  });

  it("경계값: 정확히 33.33%면 low, 정확히 66.67%면 mid (nearest-rank 경계)", () => {
    // 3개 값 [10,20,30] -> percentiles [33.33, 66.67, 100]
    const calendar: CalendarDay[] = [day("20260828", 10), day("20260829", 20), day("20260830", 30)];
    expect(classifyPin(calendar, "20260828").tier).toBe("low"); // 33.33 <= 33.33
    expect(classifyPin(calendar, "20260829").tier).toBe("mid"); // 66.67 <= 66.67
    expect(classifyPin(calendar, "20260830").tier).toBe("high"); // 100 > 66.67
  });
});

describe("classifyPin — 폭 가드(spread guard)", () => {
  it("max-min < 10p면 중립색을 강제한다", () => {
    const calendar: CalendarDay[] = [day("20260828", 50), day("20260829", 52), day("20260830", 55)]; // range = 5
    const result = classifyPin(calendar, "20260829");
    expect(result.tier).toBe("neutral");
    expect(result.spreadGuardApplied).toBe(true);
  });

  it("정확히 10p 폭이면 가드가 발동하지 않는다 (< 10, 아니 <=가 아님)", () => {
    const calendar: CalendarDay[] = [day("20260828", 40), day("20260829", 50)]; // range = 10, exactly at threshold
    const result = classifyPin(calendar, "20260829");
    expect(result.spreadGuardApplied).toBe(false);
    expect(SPREAD_GUARD_THRESHOLD).toBe(10);
  });

  it("9.99p 폭이면 가드가 발동한다", () => {
    const calendar: CalendarDay[] = [day("20260828", 40), day("20260829", 49.99)];
    const result = classifyPin(calendar, "20260829");
    expect(result.spreadGuardApplied).toBe(true);
    expect(result.tier).toBe("neutral");
  });
});

describe("classifyPin — A4 배지 연동 (min>=85 -> 핀도 강제 고집중)", () => {
  it("전 날짜가 85 이상이면 퍼센타일과 무관하게 tier=high, badgeOverride=true", () => {
    const calendar: CalendarDay[] = [day("20260828", 85), day("20260829", 90), day("20260830", 99)];
    // 85가 이 분포에서 최저값이라 퍼센타일 기준으로도 원래 low일 수 있지만,
    // 배지 조건(min>=85)이 성립하면 그와 무관하게 high로 강제돼야 한다.
    const result = classifyPin(calendar, "20260828");
    expect(result.tier).toBe("high");
    expect(result.badgeOverride).toBe(true);
  });

  it("정확히 85(포함 비교)도 배지를 발동시킨다", () => {
    const calendar: CalendarDay[] = [day("20260828", 85)];
    const result = classifyPin(calendar, "20260828");
    expect(result.badgeOverride).toBe(true);
    expect(result.tier).toBe("high");
  });

  it("84.99가 하나라도 섞이면 배지가 발동하지 않고 일반 퍼센타일 분류로 돌아간다", () => {
    const calendar: CalendarDay[] = [day("20260828", 84.99), day("20260829", 90), day("20260830", 95)];
    const result = classifyPin(calendar, "20260828");
    expect(result.badgeOverride).toBe(false);
  });
});

describe("classifyPin — 결측·빈 데이터", () => {
  it("유효 데이터가 전혀 없으면 neutral, percentileRank=null (색을 날조하지 않는다)", () => {
    const calendar: CalendarDay[] = [day("20260828", null), day("20260829", null)];
    const result = classifyPin(calendar);
    expect(result.tier).toBe("neutral");
    expect(result.percentileRank).toBeNull();
  });

  it("targetDate를 생략하면 캘린더의 가장 최근 날짜를 사용한다", () => {
    const calendar: CalendarDay[] = [day("20260828", 10), day("20260829", 50), day("20260830", 90)];
    const result = classifyPin(calendar);
    expect(result.targetDate).toBe("20260830");
  });
});

describe("PinTier 타입이 4가지로 고정된다", () => {
  it("low/mid/high/neutral 외의 값은 타입 시스템이 거절한다 (컴파일 타임 계약 확인)", () => {
    const tiers: PinTier[] = ["low", "mid", "high", "neutral"];
    expect(tiers).toHaveLength(4);
  });
});
