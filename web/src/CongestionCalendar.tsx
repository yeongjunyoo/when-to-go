// 날짜별 혼잡도 히트맵 캘린더.
//
// 이 화면이 제품의 전부다 — 「언제 가면 덜 붐비나」를 한눈에 보여주는 곳.
// 이전 판은 날짜 카드를 3~5열로 나열해서 한눈에 보는 게 불가능했다.
//
// ★ 색을 매기는 규칙은 지도 핀(pinClassify.ts)과 **같은 근거**를 쓴다.
//   - 등급은 그 관광지 **자기 자신의 분포 안에서의 퍼센타일**로 정한다.
//     원시 집중률로 직접 칠하지 않는다 — 집중률은 시군구 단위 상대 정규화값이라
//     관광지 간 비교가 성립하지 않는다.
//   - 변동 폭이 SPREAD_GUARD_THRESHOLD 미만이면 **칠하지 않는다.**
//     없는 변별을 색으로 만들어내지 않기 위해서다. 핀과 같은 가드다.
//   - 색만으로 정보를 전달하지 않는다. 모든 칸에 숫자가 같이 있고,
//     스크린리더용 aria-label 에 날짜·값·등급을 문장으로 넣는다.
import { useMemo } from "react";
import type { CalendarDay } from "./attractionAnalysis";
import { formatYmd } from "./attractionAnalysis";
import { buildHeatGrid, type HeatStep } from "./calendarGrid";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

// Tailwind 는 소스에 **문자 그대로** 있는 클래스만 생성한다.
// `bg-heat-${step}` 같은 동적 조합은 스캐너가 못 찾으므로 리터럴 맵으로 둔다.
const HEAT_BG = {
  1: "bg-heat-1",
  2: "bg-heat-2",
  3: "bg-heat-3",
  4: "bg-heat-4",
  5: "bg-heat-5",
} as const;

const HEAT_LABEL: Record<HeatStep, string> = {
  1: "가장 한산",
  2: "한산",
  3: "보통",
  4: "붐빔",
  5: "가장 붐빔",
};

function parseYmd(baseYmd: string): Date {
  const y = Number(baseYmd.slice(0, 4));
  const m = Number(baseYmd.slice(4, 6));
  const d = Number(baseYmd.slice(6, 8));
  return new Date(y, m - 1, d);
}

interface Props {
  calendar: CalendarDay[];
  /** 추천 3일의 baseYmd. 캘린더 안에서도 눈에 띄게 표시한다. */
  recommendedYmds?: string[];
}

export default function CongestionCalendar({ calendar, recommendedYmds = [] }: Props) {
  // 판단 로직은 calendarGrid.ts 에 있다 (tests/calendar-grid.test.ts 가 고정한다).
  // 여기서 다시 계산하면 테스트가 지키는 코드와 실제로 도는 코드가 갈라진다.
  const { weeks, colored, spread } = useMemo(
    () => buildHeatGrid(calendar, recommendedYmds),
    [calendar, recommendedYmds],
  );

  if (calendar.length === 0) {
    return (
      <p className="rounded-md border border-default bg-surface-sunken p-3 text-sm text-text-muted">
        표시할 예보가 없습니다.
      </p>
    );
  }

  return (
    <section aria-label="날짜별 집중률 캘린더">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">날짜별 혼잡도</h3>
        <p className="text-xs text-text-subtle">이 관광지 자기 기준</p>
      </div>

      {!colored && (
        <p
          role="status"
          className="mb-2 rounded-md border border-default bg-surface-sunken p-3 text-xs text-text-muted"
        >
          이 기간 차이 거의 없음 (최대 {spread.toFixed(1)}%p) — 없는 변별을 색으로 만들지 않으려고 칠하지 않았습니다.
        </p>
      )}

      {/* 요일 머리 */}
      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-medium text-text-subtle">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell, i) => {
          if (!cell.day) {
            return <div key={`pad-${i}`} aria-hidden="true" />;
          }
          const { day, step, recommended: isRec } = cell;
          const date = parseYmd(day.baseYmd);
          const hasValue = day.cnctrRate !== null;

          const bg = step !== null ? HEAT_BG[step] : "no-data-fill";
          const tierText = step !== null ? HEAT_LABEL[step] : null;

          const label = [
            formatYmd(day.baseYmd),
            hasValue ? `집중률 ${day.cnctrRate!.toFixed(1)}퍼센트` : "집중률 정보 없음",
            tierText,
            isRec ? "추천일" : null,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <div
              key={day.baseYmd}
              aria-label={label}
              className={`relative flex min-h-16 flex-col justify-between rounded-md border p-1.5 ${bg} ${
                isRec ? "border-accent shadow-sm ring-2 ring-accent" : "border-default"
              }`}
            >
              <span className="text-xs font-medium text-text-muted" aria-hidden="true">
                {date.getDate()}
              </span>
              <span
                className={`tabular text-right text-sm font-semibold ${
                  hasValue ? "text-text" : "text-text-subtle"
                }`}
                aria-hidden="true"
              >
                {hasValue ? `${day.cnctrRate!.toFixed(0)}%` : "—"}
              </span>
              {isRec && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1.5 text-xs font-medium text-text-on-accent"
                >
                  추천
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 범례 — 다섯 단계에 전부 이름을 붙인다.
        * 접근성이 괜찮은 혼잡도 서비스들의 공통점이 색과 텍스트를 항상 같이 쓰는 것이고,
        * 권장 우선순위도 숫자 > 텍스트 등급 > 색이다. 색은 맨 뒤 채널로만 둔다. */}
      {colored && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {([1, 2, 3, 4, 5] as const).map((step) => (
            <li key={step} className="inline-flex items-center gap-1.5">
              <i
                className={`inline-block h-3 w-3 rounded-sm border border-default ${HEAT_BG[step]}`}
                aria-hidden="true"
              />
              {HEAT_LABEL[step]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <i
              className="no-data-fill inline-block h-3 w-3 rounded-sm border border-default"
              aria-hidden="true"
            />
            정보 없음
          </li>
        </ul>
      )}
    </section>
  );
}
