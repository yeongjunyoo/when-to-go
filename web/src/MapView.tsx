// B4 map view. This module is imported ONLY via React.lazy() from App.tsx
// behind the MAP_ENABLED flag — a user who never opens the map never
// downloads Leaflet or this file's code (route-level code splitting).
//
// Tile provider: tile.openstreetmap.org (OpenStreetMap Standard raster
// tiles), per the OSMF Tile Usage Policy
// (https://operations.osmfoundation.org/policies/tiles/), confirmed
// 2026-08-28. Compliance in this component:
//   - exact URL https://tile.openstreetmap.org/{z}/{x}/{y}.png (never http, never a mirror host)
//   - visible attribution "© OpenStreetMap contributors" always rendered (never hidden/toggleable)
//   - browser default caching is used (no Cache-Control:no-cache override) — Leaflet's
//     default tile loading respects standard HTTP caching, satisfying the >=7-day/
//     honor-server-headers requirement without extra code
//   - NO prefetch, NO "download for offline" feature, NO bulk/background tile
//     fetching outside the current viewport — only the interactive viewport's tiles load
//   - User-Agent is set by the browser automatically for this kind of client-side
//     fetch; there is no server-side proxy or SDK masking it
// If tile ToS terms change or cannot be re-confirmed, flip
// VITE_ENABLE_MAP=false (see featureFlags.ts) rather than patching this file live.
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AttractionRow } from "./proxyClient";
import { buildCalendar } from "./attractionAnalysis";
import { classifyPin } from "./pinClassify";
import { pinTierColor } from "./design/token";
import { PoiIndex, resolveAttraction } from "./match";
import { groupAttractionsAlphabetically } from "./sortAttractions";
import { summarizeUnmatchedTypes } from "./unmatchedTypes";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface Props {
  items: AttractionRow[];
  poiIndex: PoiIndex | null;
  sidoName: string;
  signguName: string;
}

export default function MapView({ items, poiIndex, sidoName, signguName }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const attractions = useMemo(() => groupAttractionsAlphabetically(items), [items]);

  const pins = useMemo(() => {
    if (!poiIndex) return [];
    const result: { name: string; lat: number; lng: number; tier: ReturnType<typeof classifyPin> }[] = [];
    for (const attraction of attractions) {
      const outcome = resolveAttraction(attraction.tAtsNm, poiIndex, sidoName, signguName);
      if (outcome.kind !== "single_match") continue;
      const lat = Number(outcome.poi.mapy);
      const lng = Number(outcome.poi.mapx);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const calendar = buildCalendar(attraction.rows);
      result.push({ name: attraction.tAtsNm, lat, lng, tier: classifyPin(calendar) });
    }
    return result;
  }, [attractions, poiIndex, sidoName, signguName]);

  const unmatchedNames = useMemo(() => {
    if (!poiIndex) return [];
    return attractions
      .filter((a) => resolveAttraction(a.tAtsNm, poiIndex, sidoName, signguName).kind !== "single_match")
      .map((a) => a.tAtsNm);
  }, [attractions, poiIndex, sidoName, signguName]);

  const unmatchedDistribution = useMemo(() => summarizeUnmatchedTypes(unmatchedNames), [unmatchedNames]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [36.5, 127.8], zoom: 7 });
    mapRef.current = map;
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: L.CircleMarker[] = [];
    for (const pin of pins) {
      const marker = L.circleMarker([pin.lat, pin.lng], {
        radius: 8,
        color: pinTierColor(pin.tier.tier),
        fillColor: pinTierColor(pin.tier.tier),
        fillOpacity: 0.8,
      }).addTo(map);
      const badgeNote = pin.tier.badgeOverride ? "<br/><strong>이 기간 내내 고집중</strong>" : "";
      const guardNote = pin.tier.spreadGuardApplied ? "<br/>이 기간 차이 거의 없음" : "";
      marker.bindPopup(`<strong>${escapeHtml(pin.name)}</strong>${badgeNote}${guardNote}`);
      markers.push(marker);
    }
    if (pins.length > 0) {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [24, 24] });
    }
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [pins]);

  return (
    <section aria-label="지도" className="mb-6">
      <h2 className="mb-2 text-lg font-semibold">지도</h2>
      <div ref={containerRef} className="h-80 w-full rounded-lg border border-default" role="application" aria-label="관광지 지도" />

      <div role="status" className="mt-2 rounded-md border border-default bg-surface p-3 text-xs text-text-muted">
        <p className="mb-1 font-semibold">범례</p>
        <ul className="flex flex-wrap gap-3">
          <li>
            <span className="inline-block h-3 w-3 rounded-full bg-congestion-low" /> 이 관광지 기준 저집중일
          </li>
          <li>
            <span className="inline-block h-3 w-3 rounded-full bg-congestion-mid" /> 중간
          </li>
          <li>
            <span className="inline-block h-3 w-3 rounded-full bg-congestion-high" /> 고집중(또는 기간 내내 고집중 배지)
          </li>
          <li>
            <span className="inline-block h-3 w-3 rounded-full bg-congestion-none" /> 변별 없음/데이터 없음
          </li>
        </ul>
        <p className="mt-2 font-semibold text-warn-fg">
          ⚠️ 색은 각 관광지 자기 자신의 기간 내 상대 비교입니다. 서로 다른 핀의 색을 맞비교하지 마세요 — 집중률은 시군구 단위 상대 정규화 값이라 관광지 간 비교가 무의미합니다.
        </p>
      </div>

      {pins.length > 0 && (
        <div className="mt-2 rounded-md border border-default bg-surface p-3 text-xs text-text-muted">
          <p className="mb-1 font-semibold">지도 핀 목록(텍스트 대체)</p>
          <p className="mb-2 text-text-subtle">지도는 시각 정보라 보조공학기기로 전부 전달되지 않을 수 있습니다. 아래 목록이 해당 관광지와 색상 등급을 텍스트로 제공합니다.</p>
          <ul className="space-y-1">
            {pins.map((pin) => (
              <li key={pin.name}>
                {pin.name}: {pinTierLabel(pin.tier.tier)}
                {pin.tier.badgeOverride && " — 이 기간 내내 고집중"}
                {pin.tier.spreadGuardApplied && " — 이 기간 차이 거의 없음"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unmatchedNames.length > 0 && (
        <div role="status" className="mt-2 rounded-md border border-warn-border bg-warn-bg p-3 text-xs text-warn-fg">
          <p className="font-semibold">
            위치 정보 없음 {unmatchedNames.length}곳 (지도에 표시되지 않음)
          </p>
          <ul className="mt-1 list-inside list-disc">
            {Object.entries(unmatchedDistribution.counts)
              .filter(([, count]) => count > 0)
              .map(([category, count]) => (
                <li key={category}>
                  {category}: {count}곳
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function pinTierLabel(tier: "low" | "mid" | "high" | "neutral"): string {
  switch (tier) {
    case "low":
      return "저집중일";
    case "mid":
      return "중간";
    case "high":
      return "고집중";
    case "neutral":
      return "변별 없음/데이터 없음";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
