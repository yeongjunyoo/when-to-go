import { AttractionRow } from "./proxyClient";
import {
  buildCalendar,
  highConcentrationBadge,
  recommendedDays,
  computeDateRange,
  computeFreshness,
  formatYmd,
} from "./attractionAnalysis";
import CongestionCalendar from "./CongestionCalendar";

interface Props {
  tAtsNm: string;
  rows: AttractionRow[];
  /** false when the surrounding collection was incomplete — suppresses recommendations, per contest rule. */
  collectionComplete: boolean;
  fetchedAt: number;
  onClose: () => void;
}

export default function AttractionDetail({
  tAtsNm,
  rows,
  collectionComplete,
  fetchedAt,
  onClose,
}: Props) {
  const calendar = buildCalendar(rows);
  const badge = highConcentrationBadge(calendar);
  // 부분 응답(수집 불완전)이면 추천을 내지 않는다 — 불완전 데이터로 추천하지 않는다.
  const recommendations = collectionComplete ? recommendedDays(calendar) : [];
  const range = computeDateRange(rows);
  const freshness = range ? computeFreshness(range, fetchedAt) : null;
  const showRecommendations = collectionComplete && badge !== true && recommendations.length > 0;

  return (
    <section
      aria-label={`${tAtsNm} 상세`}
      className="mb-6 rounded-lg border border-default bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold">{tAtsNm}</h2>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-default px-2.5 py-1 text-sm text-text-muted transition-colors duration-fast ease-standard hover:bg-surface-hover"
        >
          닫기
        </button>
      </div>

      {/* 추천 3일 — 화면에서 가장 먼저 읽혀야 하는 정보다 */}
      {showRecommendations && (
        <div className="mb-4 rounded-lg border border-success-border bg-success-bg p-4">
          <p className="text-sm font-semibold text-success-fg">
            이때 가면 덜 붐빕니다
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {recommendations.map((r) => (
              <li
                key={r.baseYmd}
                className="rounded-md border border-success-border bg-surface px-3 py-2"
              >
                <div className="text-sm font-semibold">{formatYmd(r.baseYmd)}</div>
                <div className="tabular text-xs text-text-muted">
                  집중률 {r.cnctrRate.toFixed(1)}%
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-success-fg">
            이 관광지 자기 기준으로 집중률이 낮은 순입니다.
          </p>
        </div>
      )}

      {!collectionComplete && (
        <div
          role="status"
          className="mb-4 rounded-md border border-warn-border bg-warn-bg p-3 text-sm text-warn-fg"
        >
          데이터 수집 중입니다 — 수집이 끝난 뒤 추천을 제공합니다.
        </div>
      )}

      {badge === true && (
        <div
          role="status"
          className="mb-4 rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger-fg"
        >
          <p className="font-semibold">이 관광지 기준으로 예보 기간 내내 집중률이 높습니다</p>
          <p className="mt-1 text-xs">
            ※ 85는 검증된 실제 인파가 아니라 명시적 휴리스틱 기준입니다. 집중률은 시군구 단위 상대
            정규화 값이라 다른 관광지와 직접 비교할 수 없습니다.
          </p>
        </div>
      )}

      {badge === null && (
        <div
          role="status"
          className="mb-4 rounded-md border border-default bg-surface-sunken p-3 text-xs text-text-muted"
        >
          이 관광지는 유효한 집중률 데이터가 없어 고집중 여부를 판단할 수 없습니다.
        </div>
      )}

      <CongestionCalendar
        calendar={calendar}
        recommendedYmds={recommendations.map((r) => r.baseYmd)}
      />

      {/* 기간·신선도는 캘린더를 읽은 뒤에 확인하는 정보라 아래에 둔다 */}
      <div className="mt-4 space-y-2 border-t border-default pt-3">
        {range && (
          <p className="text-xs text-text-subtle">
            예보 기간 {formatYmd(range.min)} ~ {formatYmd(range.max)} ({range.windowLength}일)
          </p>
        )}
        {freshness?.stale && (
          <p role="status" className="text-xs text-warn-fg">
            데이터 최종 갱신 {formatYmd(freshness.maxDate)} 기준 — 공공데이터 갱신이 지연되어 예보
            기간이 평소보다 짧습니다({freshness.windowLength}일).
          </p>
        )}
      </div>
    </section>
  );
}
