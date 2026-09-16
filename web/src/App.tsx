import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  fetchSidoList,
  fetchSigunguList,
  collectAttractionsStreaming,
  fetchRelatedTop5,
  SidoRegion,
  ProxyError,
  CollectIntegrity,
  AttractionRow,
} from "./proxyClient";
import { toSignguCd, isSejong, SEJONG_SIGNGU_CD, normalizeRegnCd } from "./regionCodes";
import { groupAttractionsAlphabetically } from "./sortAttractions";
import AttractionDetail from "./AttractionDetail";
import PoiMatch from "./PoiMatch";
import type { PoiIndex } from "./match";
import { getPoiIndexFor } from "./poiSource";
import { computeRejectionDashboard } from "./rejectionDashboard";
import RejectionDashboardBox from "./RejectionDashboardBox";
import RelatedSection, { RelatedState } from "./RelatedSection";
import { MAP_ENABLED } from "./featureFlags";

// route-level code splitting: MapView (and its Leaflet dependency) is only
// fetched when a user who has the flag on actually renders this branch.
// Users with the flag off, or who never scroll to a successful collection,
// never download this chunk.
const MapView = lazy(() => import("./MapView"));

type SidoState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "success"; regions: SidoRegion[]; fetchedAt: number; cacheHit: boolean };

type SigunguState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "success"; regions: SidoRegion[] };

type CollectState =
  | { status: "idle" }
  | { status: "loading" }
  // B6: 점진 렌더 상태 — 수집된 페이지의 관광지를 모아 보여주되, 완전성은 아직 미확정이라
  // 추천·미연결률 계기판 등 "완전함"을 전제로 하는 기능은 이 상태에서 결코 놀지 않는다.
  | { status: "collecting"; items: AttractionRow[]; pagesSoFar: number; totalCount: number | null }
  | { status: "error"; message: string }
  | { status: "incomplete"; integrity: CollectIntegrity; itemsFetched: number }
  | { status: "no-data" }
  | { status: "success"; items: AttractionRow[]; integrity: CollectIntegrity; fetchedAt: number };

type PoiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "incomplete"; failureReason?: string }
  | { status: "success"; index: PoiIndex };

// baseYm은 티맵 연관 데이터의 월별 스냅샷 파라미터다. 실측 계약값(202605)을
// 그대로 하드코딩하지 않고, 요청 시점 기준 전월(YYYYMM)을 런타임에 계산한다 —
// 업스트림이 최신 월 스냅샷만 유지하므로 고정 상수는 곧 낡는다.
function currentBaseYm(): string {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyy = prevMonth.getFullYear();
  const mm = String(prevMonth.getMonth() + 1).padStart(2, "0");
  return `${yyyy}${mm}`;
}

export default function App() {
  const [sido, setSido] = useState<SidoState>({ status: "loading" });
  const [selectedSido, setSelectedSido] = useState<SidoRegion | null>(null);
  const [sigungu, setSigungu] = useState<SigunguState>({ status: "idle" });
  const [selectedSigngu, setSelectedSigngu] = useState<{ code: string; name: string } | null>(null);
  const [collect, setCollect] = useState<CollectState>({ status: "idle" });
  const [selectedAttraction, setSelectedAttraction] = useState<string | null>(null);
  const [poi, setPoi] = useState<PoiState>({ status: "idle" });
  const [related, setRelated] = useState<RelatedState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetchSidoList()
      .then((result) => {
        if (cancelled) return;
        setSido(result.regions.length === 0 ? { status: "empty" } : { status: "success", ...result });
      })
      .catch((err) => {
        if (cancelled) return;
        setSido({ status: "error", message: err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelectSido(region: SidoRegion) {
    setSelectedSido(region);
    setSelectedSigngu(null);
    setCollect({ status: "idle" });
    setSelectedAttraction(null);

    if (isSejong(region.code)) {
      // Sejong: single-tier special city — no signgu sub-selection step.
      setSigungu({ status: "idle" });
      setSelectedSigngu({ code: SEJONG_SIGNGU_CD, name: region.name });
      return;
    }

    setSigungu({ status: "loading" });
    // 세종은 위에서 이미 돌아갔으므로 여기는 2자리 시도만 남는다. 방어적으로 정규화한다.
    fetchSigunguList(normalizeRegnCd(region.code))
      .then((result) => {
        setSigungu(result.regions.length === 0 ? { status: "empty" } : { status: "success", regions: result.regions });
      })
      .catch((err) => {
        setSigungu({ status: "error", message: err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
  }

  function handleSelectSigngu(signgu: SidoRegion) {
    if (!selectedSido) return;
    const signguCd = toSignguCd(normalizeRegnCd(selectedSido.code), signgu.code);
    setSelectedSigngu({ code: signguCd, name: signgu.name });
    setSelectedAttraction(null);
    setPoi({ status: "idle" });
    setRelated({ status: "idle" });
  }

  useEffect(() => {
    if (!selectedSido || !selectedSigngu) return;
    let cancelled = false;
    setCollect({ status: "loading" });
    // `areaCd`는 2자리 계약이다. 세종은 시도 목록에서 5자리(`36110`)로 내려오므로
    // 그대로 보내면 검증에 걸린다 — 앞 2자리로 정규화해서 보낸다.
    //
    // 실측(2026-08-28, 리더 실배포본 1회 호출): 제주시(8페이지) 캐시미스 수집이 약 5.0초로
    // 5초 임계에 바로 걸쳐 있었다 — 그래서 항상 스트리밍 경로로 가서 수집된 페이지부터
    // 즉시 보여준다(관광지를 임의로 누락하거나 상위 N으로 자르지 않는다 — 하드룰).
    let accumulatedItems: AttractionRow[] = [];
    collectAttractionsStreaming(normalizeRegnCd(selectedSido.code), selectedSigngu.code, (pageItems, pageNo, totalCount) => {
      if (cancelled) return;
      accumulatedItems = [...accumulatedItems, ...pageItems];
      setCollect({ status: "collecting", items: accumulatedItems, pagesSoFar: pageNo, totalCount });
    })
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome.ok) {
          setCollect({
            status: "incomplete",
            integrity:
              outcome.integrity ??
              ({
                stableTotal: false,
                rawExact: false,
                uniqueExact: false,
                windowExact: false,
                complete: false,
                totalCount: null,
                rawFetched: outcome.itemsFetched,
                uniqueFetched: 0,
                pages: 0,
                windowLength: 0,
                offendingAttractions: [],
                failureReason: outcome.message ?? "stream ended unexpectedly",
              } satisfies CollectIntegrity),
            itemsFetched: outcome.itemsFetched,
          });
          return;
        }
        if (outcome.items.length === 0) {
          setCollect({ status: "no-data" });
          return;
        }
        setCollect({ status: "success", items: outcome.items, integrity: outcome.integrity, fetchedAt: Date.now() });
      })
      .catch((err) => {
        if (cancelled) return;
        setCollect({ status: "error", message: err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSido, selectedSigngu]);

  // B3/B5: POI 후보집합 — signguCd = lDongRegnCd(2)+lDongSignguCd(3) 문자열 연결으로
  // 만들어졌다는 계약을 그대로 이용해 둘로 나눈다(선행 0 보존).
  // getPoiIndexFor()가 B-index(승인 시)를 먼저 시도하고 없거나 미을 때 B-live로
  // 투명하게 폴백한다 — 이 컴포넌트는 어느 경로인지 전혀 알 필요가 없다.
  useEffect(() => {
    if (!selectedSigngu || !selectedSido) return;
    let cancelled = false;
    const lDongRegnCd = selectedSigngu.code.slice(0, 2);
    const lDongSignguCd = selectedSigngu.code.slice(2);
    setPoi({ status: "loading" });
    getPoiIndexFor(lDongRegnCd, lDongSignguCd, selectedSido.name, selectedSigngu.name)
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome.ok) {
          setPoi({ status: "incomplete", failureReason: outcome.failureReason });
          return;
        }
        setPoi({ status: "success", index: outcome.index });
      })
      .catch((err) => {
        if (cancelled) return;
        setPoi({ status: "error", message: err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSido, selectedSigngu]);

  // B3: 티맵 연관 관광지 상위 5개 — 데이터 없는 시군구(경기도 화성시)는 빈 상태로 명시.
  useEffect(() => {
    if (!selectedSido || !selectedSigngu) return;
    let cancelled = false;
    setRelated({ status: "loading" });
    fetchRelatedTop5(normalizeRegnCd(selectedSido.code), selectedSigngu.code, currentBaseYm())
      .then((envelope) => {
        if (cancelled) return;
        setRelated(envelope.empty ? { status: "empty" } : { status: "success", items: envelope.items });
      })
      .catch((err) => {
        if (cancelled) return;
        setRelated({ status: "error", message: err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSido, selectedSigngu]);

  const poiIndex = useMemo(() => {
    if (poi.status !== "success") return null;
    return poi.index;
  }, [poi]);

  const rejectionDashboard = useMemo(() => {
    if (!poiIndex || collect.status !== "success") return null;
    const names = groupAttractionsAlphabetically(collect.items).map((a) => a.tAtsNm);
    if (!selectedSido || !selectedSigngu) return null;
    return computeRejectionDashboard(names, poiIndex, selectedSido.name, selectedSigngu.name);
  }, [poiIndex, collect, selectedSido, selectedSigngu]);

  return (
    <div className="min-h-screen w-full bg-canvas px-4 py-8 text-text">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">언제 가지</h1>
        <p className="mt-1 text-sm text-text-muted">공공데이터 기반 관광 혼잡도 안내</p>
      </header>

      <section aria-label="시도 선택" className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">1. 시도 선택</h2>
        {sido.status === "loading" && <StatusBox role="status">불러오는 중…</StatusBox>}
        {sido.status === "error" && <StatusBox role="alert" tone="error">오류: {sido.message}</StatusBox>}
        {sido.status === "empty" && <StatusBox role="status" tone="empty">데이터 없음</StatusBox>}
        {sido.status === "success" && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sido.regions.map((region) => (
              <li key={region.code}>
                <button
                  type="button"
                  onClick={() => handleSelectSido(region)}
                  aria-pressed={selectedSido?.code === region.code}
                  className={`w-full rounded-md border p-2 text-sm ${
                    selectedSido?.code === region.code ? "border-accent bg-accent-subtle font-semibold" : "border-default bg-surface hover:bg-surface-hover"
                  }`}
                >
                  {region.name}
                  {selectedSido?.code === region.code && <span className="sr-only"> (선택됨)</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedSido && !isSejong(selectedSido.code) && (
        <section aria-label="시군구 선택" className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">2. 시군구 선택 ({selectedSido.name})</h2>
          {sigungu.status === "loading" && <StatusBox role="status">불러오는 중…</StatusBox>}
          {sigungu.status === "error" && <StatusBox role="alert" tone="error">오류: {sigungu.message}</StatusBox>}
          {sigungu.status === "empty" && <StatusBox role="status" tone="empty">데이터 없음</StatusBox>}
          {sigungu.status === "success" && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {sigungu.regions.map((signgu) => (
                <li key={signgu.code}>
                  <button
                    type="button"
                    onClick={() => handleSelectSigngu(signgu)}
                    className="w-full rounded-md border border-default bg-surface p-2.5 text-sm transition-colors duration-fast ease-standard hover:bg-surface-hover"
                  >
                    {signgu.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selectedSido && isSejong(selectedSido.code) && (
        <section aria-label="세종특별자치시 안내" className="mb-6">
          <StatusBox role="status" tone="empty">세종특별자치시는 단층 광역자치단체라 시군구 선택 없이 바로 조회합니다.</StatusBox>
        </section>
      )}

      {selectedSigngu && (
        <section aria-label="관광지 목록">
          <h2 className="mb-2 text-lg font-semibold">3. 관광지 목록 ({selectedSigngu.name}, 가나다순)</h2>
          {collect.status === "loading" && <StatusBox role="status">전체 페이지 수집 중…</StatusBox>}
          {collect.status === "collecting" && (
            <div role="status" aria-live="polite" className="mb-2 rounded-lg border border-info-border bg-info-bg p-3 text-sm text-info-fg">
              <p className="mb-2 font-semibold">
                수집 중… {collect.pagesSoFar}페이지 불러옴 · 현재 {collect.items.length}행
                {collect.totalCount !== null && ` / 총 ${collect.totalCount}행`}
              </p>
              <p className="mb-2 text-xs">수집이 끝나야 완전한 상태로 판정됩니다 — 아래 관광지는 지금까지 받은 페이지 기준이며 일부일 수 있습니다.</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {groupAttractionsAlphabetically(collect.items).map((attraction) => (
                  <li key={attraction.tAtsNm} className="rounded-md border border-info-border bg-surface p-2 text-xs text-text-muted">
                    {attraction.tAtsNm}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {collect.status === "error" && <StatusBox role="alert" tone="error">오류: {collect.message}</StatusBox>}
          {collect.status === "no-data" && <StatusBox role="status" tone="empty">데이터 없음</StatusBox>}
          {collect.status === "incomplete" && (
            <StatusBox role="alert" tone="error">
              수집 불완전: {collect.integrity.failureReason ?? "알 수 없는 사유"} ({collect.itemsFetched}건 수집됨, 표시하지 않음)
            </StatusBox>
          )}
          {collect.status === "success" && (
            <div>
              <p className="mb-2 text-xs text-text-subtle">
                {collect.integrity.totalCount ?? "?"}행 · {groupAttractionsAlphabetically(collect.items).length}개 관광지 · 기준시각{" "}
                {new Date(collect.fetchedAt).toLocaleString("ko-KR")}
              </p>
              <ul className="divide-y divide-default rounded-md border border-default bg-surface">
                {groupAttractionsAlphabetically(collect.items).map((attraction) => (
                  <li key={attraction.tAtsNm}>
                    <button
                      type="button"
                      onClick={() => setSelectedAttraction(attraction.tAtsNm)}
                      aria-pressed={selectedAttraction === attraction.tAtsNm}
                      className={`w-full p-2.5 text-left text-sm transition-colors duration-fast ease-standard hover:bg-surface-hover ${selectedAttraction === attraction.tAtsNm ? "bg-accent-subtle font-semibold" : ""}`}
                    >
                      {attraction.tAtsNm}
                      {selectedAttraction === attraction.tAtsNm && <span className="sr-only"> (선택됨)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {MAP_ENABLED && collect.status === "success" && selectedSido && selectedSigngu && (
        <Suspense fallback={<StatusBox role="status">지도 불러오는 중…</StatusBox>}>
          <MapView items={collect.items} poiIndex={poiIndex} sidoName={selectedSido.name} signguName={selectedSigngu.name} />
        </Suspense>
      )}

      {collect.status === "success" && rejectionDashboard && (
        <RejectionDashboardBox dashboard={rejectionDashboard} />
      )}

      {collect.status === "success" && selectedAttraction && (
        <AttractionDetail
          tAtsNm={selectedAttraction}
          rows={collect.items.filter((row) => row.tAtsNm === selectedAttraction)}
          collectionComplete={collect.integrity.complete}
          fetchedAt={collect.fetchedAt}
          onClose={() => setSelectedAttraction(null)}
        />
      )}

      {collect.status === "success" && selectedAttraction && selectedSido && selectedSigngu && (
        <PoiMatch attractionName={selectedAttraction} poiIndex={poiIndex} sidoName={selectedSido.name} signguName={selectedSigngu.name} />
      )}

      {selectedSigngu && <RelatedSection state={related} />}
    </div>
  );
}

function StatusBox({ role, tone = "info", children }: { role: "status" | "alert"; tone?: "info" | "error" | "empty"; children: React.ReactNode }) {
  const toneClass =
    tone === "error" ? "border-danger-border bg-danger-bg text-danger-fg" : tone === "empty" ? "border-warn-border bg-warn-bg text-warn-fg" : "border-default bg-surface text-text-muted";
  // role="status"/"alert" already imply an implicit aria-live (polite/assertive
  // respectively) per the ARIA spec, so a screen reader announces loading,
  // empty, and error states as they change without extra wiring.
  return (
    <div role={role} className={`rounded-lg border p-4 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}
