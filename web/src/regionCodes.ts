// Mirror of worker/src/region-codes.ts for the frontend. Kept in sync
// manually (no shared package in this scaffold) — string concatenation
// only, never numeric, so leading zeros survive.
//
// ⚠️ 실측(2026-08-28, 배포본 실호출): `ldongCode2`의 시도 목록은 15개를 2자리로 주는데
// **세종만 `code="36110"`(5자리)로 내려온다.** 단층 광역시라 시도와 시군구가 합쳐진 형태다.
// 최초 구현은 `=== "36"`을 가정해 세종 선택 시 terminal node 판정이 날아가고
// 5자리 값이 2자리 검증에 걸려 오류가 떴다. 응답의 실제 모양을 계약으로 고정한다.

export const SEJONG_REGN_CD = "36";
export const SEJONG_SIGNGU_CD = "36110";
/** `ldongCode2`가 세종을 내려주는 실제 코드(5자리 단일 값). */
export const SEJONG_LDONG_CODE = "36110";

export function toSignguCd(lDongRegnCd: string, lDongSignguCd: string): string {
  return `${lDongRegnCd}${lDongSignguCd}`;
}

/** 시도 목록의 원본 코드(`36110`)와 정규화된 2자리(`36`)를 모두 세종으로 인정한다. */
export function isSejong(code: string): boolean {
  return code === SEJONG_REGN_CD || code === SEJONG_LDONG_CODE;
}

/**
 * 시도 목록의 `code`를 2자리 광역 코드로 정규화한다.
 * 세종처럼 5자리로 내려오는 단층 특례를 앞 2자리로 줄인다(문자열 절단, 수치 연산 아님).
 */
export function normalizeRegnCd(code: string): string {
  if (!/^\d{2}$|^\d{5}$/.test(code)) {
    throw new Error(`unexpected sido code shape: expected 2 or 5 digits, got ${code.length}`);
  }
  return code.length === 5 ? code.slice(0, 2) : code;
}
