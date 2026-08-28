import { useEffect, useState } from "react";
import { fetchDetailCommon, fetchDetailImages, DetailCommon, DetailImage } from "./proxyClient";
import { PoiIndex, resolveAttraction, MatchOutcome } from "./match";

interface Props {
  attractionName: string;
  poiIndex: PoiIndex | null;
  sidoName: string;
  signguName: string;
}

type DetailState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "success"; common: DetailCommon | null; images: DetailImage[] };

/**
 * Renders one of the 4 B-live resolution outcomes for a single attraction
 * name. NEVER guesses a mapping on multiple_candidates, and NEVER shows
 * detail on zero_candidates or address_mismatch.
 */
export default function PoiMatch({ attractionName, poiIndex, sidoName, signguName }: Props) {
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });

  const outcome: MatchOutcome | null = poiIndex ? resolveAttraction(attractionName, poiIndex, sidoName, signguName) : null;
  const singleMatchContentId = outcome?.kind === "single_match" ? outcome.poi.contentid : null;

  useEffect(() => {
    if (!singleMatchContentId) {
      setDetail({ status: "idle" });
      return;
    }
    let cancelled = false;
    setDetail({ status: "loading" });
    Promise.all([fetchDetailCommon(singleMatchContentId), fetchDetailImages(singleMatchContentId)])
      .then(([common, images]) => {
        if (cancelled) return;
        setDetail({ status: "success", common, images });
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail({ status: "error", message: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
    return () => {
      cancelled = true;
    };
  }, [singleMatchContentId]);

  if (!poiIndex) {
    return (
      <div role="status" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        위치 정보를 불러오는 중…
      </div>
    );
  }

  if (!outcome || outcome.kind === "zero_candidates") {
    return (
      <div role="status" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        위치 정보 없음 — 공공데이터에서 이 관광지와 연결되는 후보를 찾지 못했습니다.
      </div>
    );
  }

  if (outcome.kind === "multiple_candidates") {
    return (
      <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        위치 정보 없음 — 이름이 같은 후보가 {outcome.candidates.length}건 있어 어느 곳인지 추측하지 않았습니다.
      </div>
    );
  }

  if (outcome.kind === "address_mismatch") {
    return (
      <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        위치 정보 없음 — 후보 주소가 이 시군구와 일치하지 않아 표시하지 않았습니다.
      </div>
    );
  }

  // single_match
  return (
    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
      <p className="mb-1 font-semibold">📍 연결 추정: {outcome.poi.title}</p>
      <p className="mb-2 text-blue-600">
        ※ 이름 매칭 기반 자동 연결이며 정확도는 별도로 측정되지 않았습니다. 주소: {outcome.poi.addr1 || "정보 없음"}
      </p>

      {detail.status === "loading" && <p role="status">상세 정보 불러오는 중…</p>}
      {detail.status === "error" && (
        <p role="alert" className="text-red-700">
          오류: {detail.message}
        </p>
      )}
      {detail.status === "success" && (
        <div>
          {detail.common?.overview && <p className="mb-2 whitespace-pre-wrap">{detail.common.overview}</p>}
          {detail.images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {detail.images.slice(0, 4).map((img) => (
                <img key={img.originimgurl} src={img.originimgurl} alt={outcome.poi.title} className="h-20 w-20 flex-none rounded object-cover" />
              ))}
            </div>
          )}
          {!detail.common?.overview && detail.images.length === 0 && <p className="text-gray-500">상세 정보 없음</p>}
        </div>
      )}
    </div>
  );
}
