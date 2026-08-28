import { describe, it, expect } from "vitest";
import { classifyUnmatchedName, summarizeUnmatchedTypes } from "../web/src/unmatchedTypes";

describe("classifyUnmatchedName — match_v2.py 원인 분류 규칙과 동일", () => {
  it("전통시장·상권", () => {
    expect(classifyUnmatchedName("농업인새벽시장")).toBe("전통시장·상권");
    expect(classifyUnmatchedName("종로귀금속상가")).toBe("전통시장·상권");
  });

  it("교통·역", () => {
    expect(classifyUnmatchedName("구둔역")).toBe("교통·역");
    expect(classifyUnmatchedName("동서울터미널")).toBe("교통·역");
  });

  it("공공·행정시설", () => {
    expect(classifyUnmatchedName("원주역사박물관")).toBe("공공·행정시설");
    expect(classifyUnmatchedName("시립미술관")).toBe("공공·행정시설");
  });

  it("숙박·레저업소", () => {
    expect(classifyUnmatchedName("설악산리조트")).toBe("숙박·레저업소");
    expect(classifyUnmatchedName("워터파크")).toBe("숙박·레저업소");
  });

  it("자연지형 — 오름/봉/고지/습지/굴부리/겱자왕", () => {
    expect(classifyUnmatchedName("어승생오름")).toBe("자연지형");
    expect(classifyUnmatchedName("무명고지")).toBe("자연지형");
    expect(classifyUnmatchedName("습지원")).toBe("자연지형");
  });

  it("한옥·유적", () => {
    expect(classifyUnmatchedName("전통한옥마을")).toBe("한옥·유적");
    expect(classifyUnmatchedName("김유신묘")).toBe("한옥·유적");
  });

  it("어느 패턴에도 안 걸리면 기타(민간 소규모시설 등)", () => {
    expect(classifyUnmatchedName("동화마을수목원")).toBe("기타(민간 소규모시설 등)");
  });
});

describe("summarizeUnmatchedTypes", () => {
  it("전체 개수와 카테고리별 분포를 함께 낸다 — 개수만이 아니라 방향(치우침)을 보여준다", () => {
    const names = ["어승생오름", "무명고지", "구둔역", "김유신묘"];
    const dist = summarizeUnmatchedTypes(names);
    expect(dist.total).toBe(4);
    expect(dist.counts["자연지형"]).toBe(2);
    expect(dist.counts["교통·역"]).toBe(1);
    expect(dist.counts["한옥·유적"]).toBe(1);
  });

  it("빈 목록은 total=0, 모든 카테고리 0", () => {
    const dist = summarizeUnmatchedTypes([]);
    expect(dist.total).toBe(0);
    expect(Object.values(dist.counts).every((c) => c === 0)).toBe(true);
  });

  it("모든 카테고리 키가 항상 존재한다 (일부만 등장해도 누락되지 않는다)", () => {
    const dist = summarizeUnmatchedTypes(["동화마을수목원"]);
    expect(Object.keys(dist.counts)).toHaveLength(7);
  });
});
