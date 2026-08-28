import { describe, it, expect } from "vitest";
import * as workerCodes from "../worker/src/region-codes";
import * as webCodes from "../web/src/regionCodes";

// 이 스위트가 존재하는 이유:
// `web/src/regionCodes.ts`는 `worker/src/region-codes.ts`의 **수동 미러**다(공유 패키지 없음).
// 둘이 어긋나면 프론트와 워커가 서로 다른 지역 코드 규칙으로 동작하는데,
// 기존 테스트는 worker 쪽만 import해서 **드리프트를 감지할 수단이 없었다.**
//
// 세종 결함(worker는 고쳤는데 web 미러가 낡으면 화면만 계속 깨지는 상황)이
// 정확히 이 구조에서 나올 수 있다. 미러 계약을 기계적으로 고정한다.

describe("worker/web 지역코드 미러 동기화", () => {
  it("공유 상수 값이 완전히 일치한다", () => {
    expect(webCodes.SEJONG_REGN_CD).toBe(workerCodes.SEJONG_REGN_CD);
    expect(webCodes.SEJONG_SIGNGU_CD).toBe(workerCodes.SEJONG_SIGNGU_CD);
    expect(webCodes.SEJONG_LDONG_CODE).toBe(workerCodes.SEJONG_LDONG_CODE);
  });

  it("isSejong이 동일한 입력에 동일하게 답한다", () => {
    const inputs = ["36", "36110", "11", "50", "51", "01", "99", ""];
    for (const input of inputs) {
      expect(webCodes.isSejong(input)).toBe(workerCodes.isSejong(input));
    }
  });

  it("normalizeRegnCd가 동일한 입력에 동일한 값을 낸다", () => {
    for (const input of ["36110", "11", "01", "01010", "50110"]) {
      expect(webCodes.normalizeRegnCd(input)).toBe(workerCodes.normalizeRegnCd(input));
    }
  });

  it("normalizeRegnCd가 잘못된 입력을 양쪽 모두 거절한다", () => {
    for (const bad of ["3", "361", "3611", "361100", "", "abcde"]) {
      expect(() => webCodes.normalizeRegnCd(bad)).toThrow();
      expect(() => workerCodes.normalizeRegnCd(bad)).toThrow();
    }
  });

  it("toSignguCd가 동일한 조합에 동일한 결과를 낸다", () => {
    const pairs: Array<[string, string]> = [
      ["11", "110"],
      ["50", "110"],
      ["36", "110"],
      ["01", "010"],
      ["51", "110"],
    ];
    for (const [regn, signgu] of pairs) {
      expect(webCodes.toSignguCd(regn, signgu)).toBe(workerCodes.toSignguCd(regn, signgu));
    }
  });

  // ★ 정상 입력만 비교하면 드리프트를 못 잡는다 — 양쪽 반환값이 같아서 통과해버린다.
  // 실제 드리프트는 **거절 동작**에 있었다: worker판은 regex 검증 후 throw하는데
  // web 미러는 무검증 템플릿 리터럴이라 ('1','110') → worker throw / web "1110" 반환이었다.
  it("★ toSignguCd가 잘못된 입력을 양쪽 모두 거절한다 (거절 동작 드리프트 감지)", () => {
    const bad: Array<[string, string]> = [
      ["1", "110"],      // 시도 1자리
      ["111", "110"],    // 시도 3자리
      ["11", "10"],      // 시군구 2자리
      ["11", "1100"],    // 시군구 4자리
      ["", "110"],
      ["11", ""],
      ["ab", "110"],
      ["11", "abc"],
    ];
    for (const [regn, signgu] of bad) {
      expect(() => workerCodes.toSignguCd(regn, signgu), `worker가 ${regn}/${signgu}를 통과시켰다`).toThrow();
      expect(() => webCodes.toSignguCd(regn, signgu), `web 미러가 ${regn}/${signgu}를 통과시켰다`).toThrow();
    }
  });

  it("오류 타입까지 미러링된다 (둘 다 RegionCodeError)", () => {
    expect(() => workerCodes.toSignguCd("1", "110")).toThrow(workerCodes.RegionCodeError);
    expect(() => webCodes.toSignguCd("1", "110")).toThrow(webCodes.RegionCodeError);
    expect(() => workerCodes.normalizeRegnCd("3")).toThrow(workerCodes.RegionCodeError);
    expect(() => webCodes.normalizeRegnCd("3")).toThrow(webCodes.RegionCodeError);
  });

  it("미러가 worker의 공개 지역코드 API를 빠짐없이 제공한다", () => {
    // worker가 새 헬퍼를 추가했는데 미러에 안 옮기면 여기서 걸린다.
    const required = ["isSejong", "normalizeRegnCd", "toSignguCd", "SEJONG_REGN_CD", "SEJONG_SIGNGU_CD", "SEJONG_LDONG_CODE"];
    for (const name of required) {
      expect(webCodes, `web 미러에 ${name}이 없다`).toHaveProperty(name);
      expect(workerCodes, `worker에 ${name}이 없다`).toHaveProperty(name);
    }
  });
});
