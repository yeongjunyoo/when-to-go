import { describe, it, expect } from "vitest";
import { dedupeByName } from "../web/src/RelatedSection";
import type { RelatedAttractionRow } from "../web/src/proxyClient";

function row(name: string, rank: number, signguName = "원주시"): RelatedAttractionRow {
  return { name, rank, category: "관광지", signguName } as RelatedAttractionRow;
}

describe("연관 관광지 중복 제거", () => {
  it("같은 이름이 여러 기준 관광지에서 들어와도 한 번만 남는다", () => {
    // 업스트림 rlteRank 는 기준 관광지별 순위라 rank 1 이 여럿 나오고
    // 같은 장소가 서로 다른 기준에서 중복으로 올라온다 — 실제로 관측된 모양이다.
    const items = [
      row("오크밸리리조트", 1),
      row("미로예술원주중앙시장", 1),
      row("미로예술원주중앙시장", 1),
      row("보릿고개", 1),
      row("성문안CC", 1),
    ];
    const out = dedupeByName(items);
    expect(out.map((i) => i.name)).toEqual([
      "오크밸리리조트",
      "미로예술원주중앙시장",
      "보릿고개",
      "성문안CC",
    ]);
  });

  it("처음 등장한 순서를 유지한다", () => {
    const out = dedupeByName([row("가", 1), row("나", 2), row("가", 3)]);
    expect(out.map((i) => i.name)).toEqual(["가", "나"]);
  });

  it("앞뒤 공백만 다른 이름도 같은 것으로 본다", () => {
    const out = dedupeByName([row("치악산", 1), row(" 치악산 ", 2)]);
    expect(out).toHaveLength(1);
  });

  it("빈 목록은 빈 목록", () => {
    expect(dedupeByName([])).toEqual([]);
  });
});
