// 혼잡도 캘린더의 판단 로직. 렌더와 분리해 둔 이유는 이 규칙들이
// 테스트로 고정돼야 하는 계약이기 때문이다.
//
// ★ 지도 핀(pinClassify.ts)과 **같은 근거**를 쓴다:
//   - 등급은 그 관광지 자기 분포 안에서의 퍼센타일로 정한다.
//     원시 집중률로 직접 칠하지 않는다 — 집중률은 시군구 단위 상대 정규화값이라
//     관광지 간 비교가 성립하지 않는다.
//   - 변동 폭이 SPREAD_GUARD_THRESHOLD 미만이면 칠하지 않는다.
//     없는 변별을 색으로 만들지 않기 위해서다.
import type { CalendarDay } from "./attractionAnalysis";
import { percentileRankOf, SPREAD_GUARD_THRESHOLD } from "./pinClassify";

export type HeatStep = 1 | 2 | 3 | 4 | 5;

export interface HeatCell {
  /** null 이면 달력 앞뒤를 채우는 빈 칸이다. */
  day: CalendarDay | null;
  /** null 이면 색을 칠하지 않는다 (값 없음 또는 spread guard). */
  step: HeatStep | null;
  recommended: boolean;
}

export interface HeatGrid {
  /** 7칸씩 끊은 주 단위 행. */
  weeks: HeatCell[][];
  /** spread guard 를 통과해 실제로 색을 칠했는가. */
  colored: boolean;
  /** 유효값의 최대-최소 (퍼센트 포인트). */
  spread: number;
}

export function stepFromPercentile(p: number): HeatStep {
  if (p <= 20) return 1;
  if (p <= 40) return 2;
  if (p <= 60) return 3;
  if (p <= 80) return 4;
  return 5;
}

function weekdayOf(baseYmd: string): number {
  const y = Number(baseYmd.slice(0, 4));
  const m = Number(baseYmd.slice(4, 6));
  const d = Number(baseYmd.slice(6, 8));
  return new Date(y, m - 1, d).getDay();
}

export function buildHeatGrid(calendar: CalendarDay[], recommendedYmds: string[] = []): HeatGrid {
  if (calendar.length === 0) return { weeks: [], colored: false, spread: 0 };

  const recommended = new Set(recommendedYmds);
  const valid = calendar
    .map((d) => d.cnctrRate)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const spread = valid.length > 0 ? valid[valid.length - 1] - valid[0] : 0;
  const colored = valid.length > 0 && spread >= SPREAD_GUARD_THRESHOLD;

  const cells: HeatCell[] = calendar.map((day) => ({
    day,
    step:
      colored && day.cnctrRate !== null
        ? stepFromPercentile(percentileRankOf(day.cnctrRate, valid))
        : null,
    recommended: recommended.has(day.baseYmd),
  }));

  const blank = (): HeatCell => ({ day: null, step: null, recommended: false });
  const leading = weekdayOf(calendar[0].baseYmd);
  const padded: HeatCell[] = [...Array.from({ length: leading }, blank), ...cells];
  while (padded.length % 7 !== 0) padded.push(blank());

  const weeks: HeatCell[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  return { weeks, colored, spread };
}
