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

/** worker/src/region-codes.ts의 RegionCodeError와 동일한 역할. 오류 타입까지 미러링한다. */
export class RegionCodeError extends Error {}

/**
 * `signguCd = lDongRegnCd(2자리) + lDongSignguCd(3자리)` 문자열 연결.
 *
 * ⚠️ 검증 없는 템플릿 리터럴로 두면 안 된다. worker판은 regex로 자릿수를 검증하고
 * RegionCodeError를 던지는데 web 미러만 무검증이면, 예컨대 ('1','110')에서
 * worker는 throw하고 web은 조용히 "1110"을 반환한다. 그러면 잘못된 signguCd가
 * 프록시까지 흘러가 "signguCd must be exactly 5 digits"라는 **원인보다 한 계층 아래**의
 * 오귀인된 메시지로 실패한다. 실제 출하 경로는 이 web 모듈이므로 여기가 더 중요하다.
 */
export function toSignguCd(lDongRegnCd: string, lDongSignguCd: string): string {
  if (!/^\d{2}$/.test(lDongRegnCd)) {
    throw new RegionCodeError(`lDongRegnCd must be exactly 2 digits (leading zeros preserved), got ${JSON.stringify(lDongRegnCd)}`);
  }
  if (!/^\d{3}$/.test(lDongSignguCd)) {
    throw new RegionCodeError(`lDongSignguCd must be exactly 3 digits (leading zeros preserved), got ${JSON.stringify(lDongSignguCd)}`);
  }
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
    throw new RegionCodeError(`unexpected sido code shape: expected 2 or 5 digits, got ${code.length}`);
  }
  return code.length === 5 ? code.slice(0, 2) : code;
}
