import { AttractionRow } from "./proxyClient";
import { buildCalendar, highConcentrationBadge, recommendedDays, computeDateRange, computeFreshness, formatYmd } from "./attractionAnalysis";

interface Props {
  tAtsNm: string;
  rows: AttractionRow[];
  /** false when the surrounding collection was incomplete — suppresses recommendations, per contest rule. */
  collectionComplete: boolean;
  fetchedAt: number;
  onClose: () => void;
}

export default function AttractionDetail({ tAtsNm, rows, collectionComplete, fetchedAt, onClose }: Props) {
  const calendar = buildCalendar(rows);
  const badge = highConcentrationBadge(calendar);
  // 부분 응답(수집 불완전)이면 추천을 내지 않는다 — 불완전 데이터로 추천하지 않는다.
  const recommendations = collectionComplete ? recommendedDays(calendar) : [];
  const range = computeDateRange(rows);
  const freshness = range ? computeFreshness(range, fetchedAt) : null;

  return (
    <section aria-label={`${tAtsNm} 상세`} className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <h2 className="text-lg font-semibold">{tAtsNm}</h2>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 underline">
          닫기
        </button>
      </div>

      {freshness?.stale && (
        <div role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ 데이터 최종 갱신 {formatYmd(freshness.maxDate)} 기준 — 공공데이터 갱신이 지연되어 예보 기간이 평소보다 짧습니다({freshness.windowLength}일).
        </div>
      )}

      {range && (
        <p className="mb-3 text-xs text-gray-500">
          예보 기간: {formatYmd(range.min)} ~ {formatYmd(range.max)} ({range.windowLength}일)
        </p>
      )}

      {badge === true && (
        <div role="status" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">이 관광지 기준으로 예보 기간 내내 집중률이 높습니다</p>
          <p className="mt-1 text-xs text-red-600">
            ※ 85는 검증된 실제 인파가 아니라 명시적 휴리스틱 기준입니다. 집중률은 시군구 단위 상대 정규화 값이라 다른 관광지와 직접 비교할 수 없습니다.
          </p>
        </div>
      )}

      {badge === null && (
        <div role="status" className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          이 관광지는 유효한 집중률 데이터가 없어 고집중 여부를 판단할 수 없습니다.
        </div>
      )}

      {!collectionComplete && (
        <div role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          데이터 수집 중입니다 — 수집이 끝난 뒤 추천을 제공합니다.
        </div>
      )}

      {collectionComplete && badge !== true && recommendations.length > 0 && (
        <div className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          <p className="font-semibold">추천 3일 (이 관광지 기준, 집중률 낮은 순)</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {recommendations.map((r) => (
              <li key={r.baseYmd}>
                {formatYmd(r.baseYmd)} — {r.cnctrRate.toFixed(1)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold">날짜별 집중률 캘린더</h3>
      <ul className="grid grid-cols-3 gap-1 text-xs sm:grid-cols-5">
        {calendar.map((day) => (
          <li key={day.baseYmd} className="rounded border border-gray-200 p-2 text-center">
            <div className="text-gray-500">{formatYmd(day.baseYmd)}</div>
            <div className={day.cnctrRate === null ? "text-gray-400" : "font-semibold text-gray-800"}>
              {day.cnctrRate === null ? "정보 없음" : `${day.cnctrRate.toFixed(1)}%`}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
