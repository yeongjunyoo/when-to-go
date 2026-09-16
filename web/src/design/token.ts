// 런타임 토큰 읽기.
//
// Leaflet 마커나 canvas 처럼 CSS 클래스를 못 쓰고 색 **문자열**이 필요한 곳에서만
// 쓴다. 값을 상수로 복사해 박으면 다크모드에서 조용히 틀린 색이 나오므로,
// 항상 지금 적용된 테마에서 읽는다.
//
// 쓰는 쪽 예:
//   import { congestionColor } from "./design/token";
//   const color = congestionColor("high");

export type CongestionTier = "low" | "mid" | "high" | "none";

/** tokens.css 에 정의된 커스텀 프로퍼티를 현재 테마 기준으로 읽는다. */
export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback; // SSR·테스트 환경
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return raw.trim() || fallback;
}

/** 혼잡도 등급 색. */
export function congestionColor(tier: CongestionTier): string {
  return cssVar(`--color-congestion-${tier}`, "#9ca3af");
}

/**
 * 지도 핀 색. pinClassify 가 매긴 PinTier 를 받는다.
 *
 * PinTier 의 "neutral"(변별 없음·데이터 없음)은 토큰에서 "none" 이다 —
 * 이름이 다른 이유는 토큰 쪽이 「값이 없다」는 뜻을 더 정확히 담기 때문이다.
 * Leaflet 은 CSS 클래스를 못 받고 색 문자열이 필요해서 런타임에 읽는다.
 */
export function pinTierColor(tier: "low" | "mid" | "high" | "neutral"): string {
  return congestionColor(tier === "neutral" ? "none" : tier);
}

/** 캘린더 히트맵 단계(1~5) 색. 값이 없는 날은 heat-empty 를 쓴다. */
export function heatColor(step: 1 | 2 | 3 | 4 | 5 | null): string {
  if (step === null) return cssVar("--color-heat-empty", "#eef1f5");
  return cssVar(`--color-heat-${step}`, "#eef1f5");
}

/**
 * 집중률(0~100)을 히트맵 5단계로 나눈다.
 *
 * ★ 주의: 이 함수는 **한 관광지의 자기 분포 안에서 계산된 퍼센타일**을 받는다.
 * 원시 집중률을 그대로 넣지 마라 — 집중률은 시군구 단위 상대 정규화값이라
 * 관광지 간·시군구 간 절대 비교가 성립하지 않는다.
 * (web/src/pinClassify.ts 의 하드 계약과 tests/no-rate-ranking.test.ts 참조)
 */
export function heatStepFromPercentile(percentile: number | null): 1 | 2 | 3 | 4 | 5 | null {
  if (percentile === null || Number.isNaN(percentile)) return null;
  if (percentile <= 20) return 1;
  if (percentile <= 40) return 2;
  if (percentile <= 60) return 3;
  if (percentile <= 80) return 4;
  return 5;
}
