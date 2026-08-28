// A1 (ldongCode2/areaBasedList2 style: lDongRegnCd + lDongSignguCd) to
// A2 (tatsCnctrRatedList style: areaCd + signguCd) code conversion.
//
// signguCd = lDongRegnCd (2 chars) + lDongSignguCd (3 chars), as STRING
// concatenation — never numeric addition/parsing, or leading zeros would be
// lost (e.g. lDongRegnCd="01" + lDongSignguCd="010" must stay "01010", not
// collapse to "1010" via Number() round-tripping).
//
// areaCd == lDongRegnCd (2 chars) unchanged.

export const SEJONG_REGN_CD = "36";
export const SEJONG_SIGNGU_CD = "36110"; // Sejong has no sub-signgu; single-tier special metro city.

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

/** Sejong is a single-tier special self-governing city: no signgu sub-selection step exists. */
export function isSejong(lDongRegnCd: string): boolean {
  return lDongRegnCd === SEJONG_REGN_CD;
}
