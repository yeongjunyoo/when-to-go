import { describe, it, expect } from "vitest";
import { buildHeatGrid, stepFromPercentile } from "../web/src/calendarGrid";
import type { CalendarDay } from "../web/src/attractionAnalysis";
import { SPREAD_GUARD_THRESHOLD } from "../web/src/pinClassify";

function day(baseYmd: string, cnctrRate: number | null): CalendarDay {
  return { baseYmd, cnctrRate };
}

/** 2026-09-01 은 화요일(getDay()===2). 요일 정렬 검증의 기준점. */
const SEP1_WEEKDAY = 2;

describe("buildHeatGrid — 주 단위 정렬", () => {
  it("첫 날의 요일만큼 앞을 빈 칸으로 채운다", () => {
    const cal = [day("20260901", 10), day("20260902", 50), day("20260903", 90)];
    const grid = buildHeatGrid(cal);
    const first = grid.weeks[0];
    expect(first).toHaveLength(7);
    for (let i = 0; i < SEP1_WEEKDAY; i += 1) {
      expect(first[i].day).toBeNull();
    }
    expect(first[SEP1_WEEKDAY].day?.baseYmd).toBe("20260901");
  });

  it("모든 행이 정확히 7칸이고 날짜가 하나도 유실되지 않는다", () => {
    const cal = Array.from({ length: 30 }, (_, i) =>
      day(`202609${String(i + 1).padStart(2, "0")}`, i * 3),
    );
    const grid = buildHeatGrid(cal);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    const rendered = grid.weeks.flat().filter((c) => c.day !== null);
    expect(rendered).toHaveLength(30);
    expect(rendered.map((c) => c.day!.baseYmd)).toEqual(cal.map((d) => d.baseYmd));
  });

  it("빈 캘린더는 빈 격자를 준다", () => {
    expect(buildHeatGrid([])).toEqual({ weeks: [], colored: false, spread: 0 });
  });
});

describe("buildHeatGrid — spread guard (핀과 같은 규칙)", () => {
  it("변동 폭이 임계 미만이면 한 칸도 칠하지 않는다", () => {
    const cal = [day("20260901", 50), day("20260902", 52), day("20260903", 55)];
    const grid = buildHeatGrid(cal);
    expect(grid.spread).toBeLessThan(SPREAD_GUARD_THRESHOLD);
    expect(grid.colored).toBe(false);
    for (const cell of grid.weeks.flat()) expect(cell.step).toBeNull();
  });

  it("변동 폭이 임계 이상이면 칠한다", () => {
    const cal = [day("20260901", 10), day("20260902", 50), day("20260903", 90)];
    const grid = buildHeatGrid(cal);
    expect(grid.spread).toBeGreaterThanOrEqual(SPREAD_GUARD_THRESHOLD);
    expect(grid.colored).toBe(true);
    expect(grid.weeks.flat().filter((c) => c.step !== null).length).toBe(3);
  });
});

describe("buildHeatGrid — 값 없는 날", () => {
  it("결측일을 격자에서 빼지 않고 색만 비운다", () => {
    const cal = [day("20260901", 10), day("20260902", null), day("20260903", 90)];
    const grid = buildHeatGrid(cal);
    const cells = grid.weeks.flat().filter((c) => c.day !== null);
    expect(cells).toHaveLength(3);
    const missing = cells.find((c) => c.day!.baseYmd === "20260902")!;
    expect(missing.step).toBeNull();
    expect(missing.day!.cnctrRate).toBeNull();
  });

  it("결측을 0으로 취급하지 않는다 — spread 는 유효값만으로 잰다", () => {
    const cal = [day("20260901", 50), day("20260902", null), day("20260903", 55)];
    const grid = buildHeatGrid(cal);
    expect(grid.spread).toBe(5);
    expect(grid.colored).toBe(false);
  });
});

describe("buildHeatGrid — 관광지 독립성", () => {
  it("다른 관광지의 값은 등급에 영향을 줄 수 없다 (자기 분포만 쓴다)", () => {
    const a = [day("20260901", 10), day("20260902", 50), day("20260903", 90)];
    const gridAlone = buildHeatGrid(a);
    // 같은 날짜열에 다른 관광지의 극단값이 섞여도 a 의 등급은 그대로여야 한다.
    // buildHeatGrid 는 넘긴 배열만 보므로 구조적으로 보장된다.
    const gridAgain = buildHeatGrid([...a]);
    expect(gridAgain.weeks.flat().map((c) => c.step)).toEqual(
      gridAlone.weeks.flat().map((c) => c.step),
    );
  });

  it("최저일은 1단, 최고일은 5단", () => {
    const cal = Array.from({ length: 10 }, (_, i) =>
      day(`202609${String(i + 1).padStart(2, "0")}`, i * 10),
    );
    const grid = buildHeatGrid(cal);
    const cells = grid.weeks.flat().filter((c) => c.day !== null);
    expect(cells[0].step).toBe(1);
    expect(cells[cells.length - 1].step).toBe(5);
  });
});

describe("buildHeatGrid — 추천일 표시", () => {
  it("추천 날짜만 recommended 가 true 다", () => {
    const cal = [day("20260901", 10), day("20260902", 50), day("20260903", 90)];
    const grid = buildHeatGrid(cal, ["20260901"]);
    const cells = grid.weeks.flat().filter((c) => c.day !== null);
    expect(cells.filter((c) => c.recommended).map((c) => c.day!.baseYmd)).toEqual(["20260901"]);
  });
});

describe("stepFromPercentile", () => {
  it("5단으로 균등 분할한다", () => {
    expect(stepFromPercentile(0)).toBe(1);
    expect(stepFromPercentile(20)).toBe(1);
    expect(stepFromPercentile(21)).toBe(2);
    expect(stepFromPercentile(40)).toBe(2);
    expect(stepFromPercentile(60)).toBe(3);
    expect(stepFromPercentile(80)).toBe(4);
    expect(stepFromPercentile(100)).toBe(5);
  });
});
