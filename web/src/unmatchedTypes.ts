// Classifies unmatched (no-pin) attraction names by likely facility type,
// using the exact name-pattern categories from data/match_v2.py's
// unmatched-cause classification. This is NOT a precision claim about why
// a given name failed to match — it is a descriptive tally so the side
// panel can show whether missing pins skew toward a particular facility
// type (e.g. small-scale/natural-terrain) rather than being uniformly
// random across categories.
//
// Why this matters: if defects are NOT random but concentrate in small/
// natural-terrain categories, an unlabeled map silently shows only
// well-known, POI-registered spots — which visually contradicts the
// "쏠림 분산" (spreading visitors away from crowded hotspots) argument the
// whole app is built around. Reporting the type distribution, not just the
// defect count, is what keeps the map honest about that risk.
export type UnmatchedCategory =
  | "전통시장·상권"
  | "교통·역"
  | "공공·행정시설"
  | "숙박·레저업소"
  | "자연지형"
  | "한옥·유적"
  | "기타(민간 소규모시설 등)";

const CATEGORY_PATTERNS: Array<[UnmatchedCategory, RegExp]> = [
  ["전통시장·상권", /시장|상가|거리|골목|타운/],
  ["교통·역", /역$|역\s|터미널|공항|정류장/],
  ["공공·행정시설", /박물관|미술관|도서관|센터|청사|경찰|세관|우체국/],
  ["숙박·레저업소", /호텔|리조트|콘도|펜션|워터파크|골프/],
  ["자연지형", /오름|봉$|고지|습지|굼부리|곶자왈/],
  ["한옥·유적", /가옥|고택|한옥|묘$|릉$|사적/],
];

export function classifyUnmatchedName(name: string): UnmatchedCategory {
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return "기타(민간 소규모시설 등)";
}

export interface UnmatchedTypeDistribution {
  total: number;
  counts: Record<UnmatchedCategory, number>;
}

export function summarizeUnmatchedTypes(names: string[]): UnmatchedTypeDistribution {
  const counts: Record<UnmatchedCategory, number> = {
    "전통시장·상권": 0,
    "교통·역": 0,
    "공공·행정시설": 0,
    "숙박·레저업소": 0,
    "자연지형": 0,
    "한옥·유적": 0,
    "기타(민간 소규모시설 등)": 0,
  };
  for (const name of names) counts[classifyUnmatchedName(name)] += 1;
  return { total: names.length, counts };
}
