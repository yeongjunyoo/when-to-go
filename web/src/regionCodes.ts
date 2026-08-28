// Mirror of worker/src/region-codes.ts for the frontend. Kept in sync
// manually (no shared package in this scaffold) — string concatenation
// only, never numeric, so leading zeros survive.

export const SEJONG_REGN_CD = "36";
export const SEJONG_SIGNGU_CD = "36110";

export function toSignguCd(lDongRegnCd: string, lDongSignguCd: string): string {
  return `${lDongRegnCd}${lDongSignguCd}`;
}

export function isSejong(lDongRegnCd: string): boolean {
  return lDongRegnCd === SEJONG_REGN_CD;
}
