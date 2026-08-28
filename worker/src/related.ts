// TarRlteTarService1/areaBasedList1 related-attraction lookup ("여기 다음에
// 실제로 간 곳"). Name-only display — NEVER links to POI detail, because:
//   - related targets can be in a DIFFERENT sigungu (감포항 -> 양포항 is in
//     포항시, not 경주시), so a POI detail lookup scoped to the queried
//     sigungu would be wrong or silently miss it
//   - candidate discovery rate for these names against the POI index was
//     measured at only 19.53% (entity_precision_result.json, 원주시 related
//     source), far too low to promise a detail link exists
// One municipality (경기도 화성시) has NO related data at all — callers
// must render that as an explicit empty state, not as a silent 0-length list
// indistinguishable from "still loading" or an error.
import { fetchUpstreamPage, UpstreamEnv } from "./upstream";
import { parseTotalCount } from "./collect";

export interface RelatedAttraction {
  rank: number;
  name: string;
  category: string;
  signguName: string;
}

export interface RelatedResult {
  items: RelatedAttraction[];
  /** true only when the upstream response was well-formed AND legitimately has zero rows (e.g. 화성시). */
  empty: boolean;
  totalCount: number | null;
}

const TOP_N = 5;

export async function fetchRelatedTop5(areaCd: string, signguCd: string, baseYm: string, env: UpstreamEnv): Promise<RelatedResult | { error: string }> {
  const result = await fetchUpstreamPage({ operation: "areaBasedList1", extraParams: { areaCd, signguCd, baseYm }, numOfRows: 1000, pageNo: 1 }, env);
  if (!result.ok) return { error: result.error };

  const { items, totalCount } = extractPage(result.body);
  const ranked = [...items]
    .filter((i) => Number.isFinite(i.rank))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);

  return { items: ranked, empty: items.length === 0, totalCount };
}

function extractPage(body: unknown): { items: RelatedAttraction[]; totalCount: number | null } {
  if (typeof body !== "object" || body === null) return { items: [], totalCount: null };
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const bodyField = response?.body as Record<string, unknown> | undefined;
  const totalCount = parseTotalCount(bodyField?.totalCount);
  const itemsField = bodyField?.items as Record<string, unknown> | undefined;
  const rawItem = itemsField?.item;
  const arr = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
  const items = arr.map((raw) => normalizeItem(raw as Record<string, unknown>));
  return { items, totalCount };
}

function normalizeItem(raw: Record<string, unknown>): RelatedAttraction {
  const rankRaw = raw.rlteRank;
  const rank = typeof rankRaw === "number" ? rankRaw : Number(String(rankRaw ?? "").trim());
  return {
    rank: Number.isFinite(rank) ? rank : NaN,
    name: String(raw.rlteTatsNm ?? ""),
    category: String(raw.rlteCtgrySclsNm ?? ""),
    signguName: String(raw.rlteSignguNm ?? ""),
  };
}
