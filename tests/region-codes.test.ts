import { describe, it, expect } from "vitest";
import { toAreaCd, toSignguCd, isSejong, RegionCodeError, SEJONG_REGN_CD, SEJONG_SIGNGU_CD } from "../worker/src/region-codes";

describe("A1 -> A2 code conversion", () => {
  it("string-concatenates lDongRegnCd + lDongSignguCd, preserving leading zeros", () => {
    // The exact example from the assignment: lDongRegnCd=11, lDongSignguCd=110 -> signguCd=11110
    expect(toSignguCd("11", "110")).toBe("11110");
  });

  it("preserves a leading zero in lDongRegnCd (e.g. 01)", () => {
    expect(toSignguCd("01", "010")).toBe("01010");
    expect(toAreaCd("01")).toBe("01");
  });

  it("preserves a leading zero in lDongSignguCd (e.g. 005)", () => {
    expect(toSignguCd("26", "005")).toBe("26005");
  });

  it("never produces a numerically-collapsed result (would lose leading zeros via Number() round-trip)", () => {
    const result = toSignguCd("01", "010");
    // If this were computed via Number(lDongRegnCd) * 1000 + Number(lDongSignguCd)
    // or similar, "01"+"010" -> 1*1000+10 = "1010" (4 digits, wrong). Assert
    // the real string-concat result stays 5 digits with the leading zero.
    expect(result).toHaveLength(5);
    expect(result).toBe("01010");
    expect(result).not.toBe("1010");
  });

  it("toAreaCd passes through areaCd unchanged", () => {
    expect(toAreaCd("51")).toBe("51");
  });

  it("rejects malformed lDongRegnCd/lDongSignguCd lengths", () => {
    expect(() => toSignguCd("1", "110")).toThrow(RegionCodeError);
    expect(() => toSignguCd("11", "10")).toThrow(RegionCodeError);
    expect(() => toAreaCd("1")).toThrow(RegionCodeError);
  });
});

describe("Sejong single-tier special case", () => {
  it("identifies Sejong (lDongRegnCd=36) as a terminal node with no signgu sub-selection", () => {
    expect(isSejong(SEJONG_REGN_CD)).toBe(true);
    expect(isSejong("11")).toBe(false);
  });

  it("Sejong's fixed signguCd constant matches the documented value", () => {
    expect(SEJONG_SIGNGU_CD).toBe("36110");
  });
});
