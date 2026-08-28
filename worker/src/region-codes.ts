// A1 (ldongCode2/areaBasedList2 style: lDongRegnCd + lDongSignguCd) to
// A2 (tatsCnctrRatedList style: areaCd + signguCd) code conversion.
//
// signguCd = lDongRegnCd (2 chars) + lDongSignguCd (3 chars), as STRING
// concatenation — never numeric addition/parsing, or leading zeros would be
// lost (e.g. lDongRegnCd="01" + lDongSignguCd="010" must stay "01010", not
// collapse to "1010" via Number() round-tripping).
//
// areaCd == lDongRegnCd (2 chars) unchanged.

// ⚠️ 실측(2026-08-28, 배포본 실호출): `ldongCode2`의 시도 목록은 15개를 2자리로 주는데
// **세종만 `code="36110"`(5자리)로 내려온다.** 단층 광역시라 시도와 시군구가 합쳐진 형태다.
// 최초 구현은 `lDongRegnCd === "36"`을 가정해 세종 선택 시 terminal node 판정이 날아가고
// 5자리 값이 2자리 검증에 걸려 오류가 떴다. 유닛 테스트는 "36"을 넣어 통과했기 때문에
// 배포 후 브라우저에서야 드러난 결함이다 — 응답의 실제 모양을 계약으로 고정한다.
export const SEJONG_REGN_CD = "36";
export const SEJONG_SIGNGU_CD = "36110"; // Sejong has no sub-signgu; single-tier special metro city.
/** `ldongCode2`가 세종을 내려주는 실제 코드(5자리 단일 값). */
export const SEJONG_LDONG_CODE = "36110";

export class RegionCodeError extends Error {}

export function toAreaCd(lDongRegnCd: string): string {
  if (!/^\d{2}$/.test(lDongRegnCd)) {
    throw new RegionCodeError(`lDongRegnCd must be exactly 2 digits, got "${lDongRegnCd}"`);
  }
  return lDongRegnCd;
}

export function toSignguCd(lDongRegnCd: string, lDongSignguCd: string): string {
  if (!/^\d{2}$/.test(lDongRegnCd)) {
    throw new RegionCodeError(`lDongRegnCd must be exactly 2 digits, got "${lDongRegnCd}"`);
  }
  if (!/^\d{3}$/.test(lDongSignguCd)) {
    throw new RegionCodeError(`lDongSignguCd must be exactly 3 digits, got "${lDongSignguCd}"`);
  }
  // String concatenation ONLY — preserves leading zeros in both halves.
  return `${lDongRegnCd}${lDongSignguCd}`;
}

/**
 * Sejong is a single-tier special self-governing city: no signgu sub-selection step exists.
 *
 * `ldongCode2`가 세종을 `36110`(5자리)로 내려주므로 두 형태를 모두 받는다:
 * 시도 목록에서 온 원본 `36110`과, 정규화된 2자리 `36` 둘 다.
 */
export function isSejong(code: string): boolean {
  return code === SEJONG_REGN_CD || code === SEJONG_LDONG_CODE;
}

/**
 * 시도 목록의 `code`를 2자리 광역 코드로 정규화한다.
 * 세종처럼 5자리로 내려오는 단층 특례를 앞 2자리로 줄인다(문자열 절단, 수치 연산 아님).
 */
export function normalizeRegnCd(code: string): string {
  if (!/^\d{2}$|^\d{5}$/.test(code)) {
    throw new RegionCodeError(`unexpected sido code shape: expected 2 or 5 digits, got ${code.length}`);
  }
  return code.length === 5 ? code.slice(0, 2) : code;
}
