// Full-pagination collector for tatsCnctrRatedList (and any operation whose
// items are dedupable by a stable key). A single logical query here can
// mean multiple upstream HTTP calls; this module hides that behind one
// call and reports a hard pass/fail integrity verdict instead of silently
// returning partial data as if it were complete.
//
// Completeness invariants (ALL must hold for a collection to be marked
// complete — violating any one of them means the caller must treat the
// result as incomplete, never as quietly-successful):
//   1. stableTotal    — every page's totalCount agrees.
//   2. rawExact       — rawFetched (sum of raw items across all pages) == stableTotal.
//   3. uniqueExact    — uniqueFetched (deduped by (tAtsNm, baseYmd)) == stableTotal.
//                        If dedup collapses the count, that is a KEY COLLISION,
//                        not success — it must never be silently accepted.
//   4. windowExact    — every attraction has exactly `windowLength` rows,
//                        where windowLength = the number of distinct baseYmd
//                        values observed across the whole collection. An
//                        attraction with fewer/more rows than the window
//                        means data is missing or duplicated for it.
import { fetchUpstreamPage, UpstreamEnv } from "./upstream";

export const PAGE_SIZE = 1000;

/**
 * 페이징 반복 상한. 관측 최대치는 제주시 8페이지(7,320행)라 20은 충분히 넓고,
 * upstream이 `pageNo`를 무시하는 상황에서 무한 루프로 쿼터를 태우는 것을 막는다.
 */
export const MAX_PAGES = 20;

/** `totalCount`를 숫자로 파싱한다. 문자열로 오는 경우를 포함하며, 불확실하면 null. */
export function parseTotalCount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface TatsCnctrItem {
  baseYmd: string;
  areaCd: string;
  areaNm: string;
  signguCd: string;
  signguNm: string;
  tAtsNm: string;
  cnctrRate: number;
}

export interface CollectIntegrity {
  stableTotal: boolean;
  rawExact: boolean;
  uniqueExact: boolean;
  windowExact: boolean;
  complete: boolean;
  totalCount: number | null;
  rawFetched: number;
  uniqueFetched: number;
  pages: number;
  windowLength: number;
  offendingAttractions: string[];
  failureReason?: string;
}

export interface CollectResult {
  items: TatsCnctrItem[];
  integrity: CollectIntegrity;
}

/**
 * Fully paginates tatsCnctrRatedList for a given areaCd/signguCd and checks
 * all 4 completeness invariants. Never returns a "complete: true" result
 * that violates any invariant, and never fabricates rows to paper over a
 * gap — failure is surfaced via `integrity`.
 */
export async function collectTatsCnctrRatedList(
  areaCd: string,
  signguCd: string,
  env: UpstreamEnv,
  onPage?: (pageItems: TatsCnctrItem[], pageNo: number, totalCount: number | null) => void
): Promise<CollectResult> {
  const rawItems: TatsCnctrItem[] = [];
  const totalCounts = new Set<number>();
  const seenKeys = new Set<string>();
  let pageNo = 1;
  let pages = 0;
  let knownTotal: number | null = null;

  while (true) {
    const result = await fetchUpstreamPage(
      { operation: "tatsCnctrRatedList", extraParams: { areaCd, signguCd }, numOfRows: PAGE_SIZE, pageNo },
      env
    );

    if (!result.ok) {
      return {
        items: rawItems,
        integrity: buildFailedIntegrity(rawItems, totalCounts, pages, `upstream page ${pageNo} failed: ${result.error}`),
      };
    }

    const { items: pageItems, totalCount } = extractPage(result.body);
    pages += 1;
    if (totalCount !== null) totalCounts.add(totalCount);
    rawItems.push(...pageItems);
    onPage?.(pageItems, pageNo, totalCount);

    if (totalCount !== null) knownTotal = totalCount;

    const fetchedSoFar = pageNo * PAGE_SIZE;
    const doneByCount = knownTotal !== null && fetchedSoFar >= knownTotal;
    const doneByShortPage = pageItems.length < PAGE_SIZE;
    if (doneByCount || doneByShortPage || pageItems.length === 0) break;

    // ★ 반복 상한. upstream이 `pageNo`를 무시하고 매번 꿉 찬 페이지를 돌려주면
    // 두 종료 조건이 모두 false라 루프가 자력 탈출하지 못한다(공공 페이징 API의
    // 알려진 실패 모드). 그러면 단일 사용자 요청 하나가 서킷 상한(700)까지
    // 치달아 **일일 쿼터 1,000의 70%를 소진**한다 — 그 쿼터는 심사 증거용
    // 호출과 공유하는 풀이다. 관측 최대치는 제주시 8페이지라 상한 20은 넓다.
    if (pageNo >= MAX_PAGES) {
      return {
        items: rawItems,
        integrity: buildFailedIntegrity(
          rawItems,
          totalCounts,
          pages,
          `pagination exceeded MAX_PAGES=${MAX_PAGES} without a terminal page; upstream may be ignoring pageNo`
        ),
      };
    }

    // 새 페이지가 이미 수집한 키에 완전히 포함되면 페이징이 전진하지 않는
    // 것이므로 계속 돌려봐야 쿼터만 태운다. 명시적 실패로 끊는다.
    const before = seenKeys.size;
    for (const item of pageItems) seenKeys.add(dedupeKey(item));
    if (seenKeys.size === before) {
      return {
        items: rawItems,
        integrity: buildFailedIntegrity(
          rawItems,
          totalCounts,
          pages,
          `page ${pageNo} returned no new records; upstream pagination is not advancing`
        ),
      };
    }

    pageNo += 1;
  }

  return { items: rawItems, integrity: buildIntegrity(rawItems, totalCounts, pages) };
}

function extractPage(body: unknown): { items: TatsCnctrItem[]; totalCount: number | null } {
  if (typeof body !== "object" || body === null) return { items: [], totalCount: null };
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const bodyField = response?.body as Record<string, unknown> | undefined;
  // ⚠️ `totalCount`를 number로만 받으면 upstream이 문자열 `"7320"`을 줄 때
  // null이 돼 건수 기반 종료 조건이 무력화된다. 공공데이터 API는 숫자형 필드를
  // 문자열로 주는 일이 흔하므로 둘 다 받는다(빈 문자열·비수치는 null).
  const totalCountRaw = bodyField?.totalCount;
  const totalCount = parseTotalCount(totalCountRaw);
  const itemsField = bodyField?.items as Record<string, unknown> | undefined;
  const rawItem = itemsField?.item;
  const arr = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
  const items = arr.map((raw) => normalizeItem(raw as Record<string, unknown>));
  return { items, totalCount };
}

function normalizeItem(raw: Record<string, unknown>): TatsCnctrItem {
  return {
    baseYmd: String(raw.baseYmd ?? ""),
    areaCd: String(raw.areaCd ?? ""),
    areaNm: String(raw.areaNm ?? ""),
    signguCd: String(raw.signguCd ?? ""),
    signguNm: String(raw.signguNm ?? ""),
    tAtsNm: String(raw.tAtsNm ?? ""),
    cnctrRate: parseRate(raw.cnctrRate),
  };
}

/**
 * 집중률 원값을 숫자로 파싱한다. **결측은 반드시 NaN이 되어야 한다.**
 *
 * ⚠️ `Number(x ?? NaN)`을 쓰면 안 된다 — `??`는 null/undefined만 잡고 빈 문자열을
 * 통과시키는데 `Number("") === 0`, `Number("   ") === 0`이다. 그러면 결측이 0으로
 * 날조되고, 0은 유한수라 검증을 통과해 캘린더에 "0.0%"로 렌더되며,
 * 추천 3일이 오름차순이라 **결측일이 추천 1순위로 올라간다.**
 * 행수만 세는 불변식 4종으로는 절대 잡히지 않는다.
 *
 * 즉 "실패를 감추는 fallback 금지" 규정을 정면으로 위반하는 경로였다.
 * 빈 문자열·공백·비수치는 전부 NaN으로 떨궈 결측으로 드러낸다.
 */
export function parseRate(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== "string") return NaN;
  const trimmed = raw.trim();
  if (trimmed === "") return NaN;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function dedupeKey(item: TatsCnctrItem): string {
  return `${item.tAtsNm}::${item.baseYmd}`;
}

function buildIntegrity(rawItems: TatsCnctrItem[], totalCounts: Set<number>, pages: number): CollectIntegrity {
  const stableTotal = totalCounts.size === 1;
  const totalCount = stableTotal ? [...totalCounts][0] : null;

  const rawFetched = rawItems.length;
  const rawExact = stableTotal && totalCount !== null && rawFetched === totalCount;

  const deduped = new Map<string, TatsCnctrItem>();
  for (const item of rawItems) deduped.set(dedupeKey(item), item);
  const uniqueFetched = deduped.size;
  const uniqueExact = stableTotal && totalCount !== null && uniqueFetched === totalCount;

  // Window length = number of distinct baseYmd values seen in the unique set.
  const distinctDates = new Set([...deduped.values()].map((i) => i.baseYmd));
  const windowLength = distinctDates.size;

  const rowsPerAttraction = new Map<string, number>();
  for (const item of deduped.values()) {
    rowsPerAttraction.set(item.tAtsNm, (rowsPerAttraction.get(item.tAtsNm) ?? 0) + 1);
  }
  const offendingAttractions: string[] = [];
  for (const [name, count] of rowsPerAttraction) {
    if (count !== windowLength) offendingAttractions.push(name);
  }

  // ★ 정상적인 빈 응답과 수집 실패를 구분한다.
  // 해당 시군구에 관광지 데이터가 진짜로 없으면 `totalCount === 0`이고
  // 그때는 windowLength도 0이다. 이걸 실패로 보면 "데이터 없음" 안내 경로가
  // 죽은 코드가 되고, 사용자는 내부 무결성 진단 문구를 빨간 오류로 보게 된다.
  // 실측(QA 레드팀): 데이터 없는 시군구에서 "0 attraction(s) have row count != window length (0)"가 땴4다.
  // 빈 응답은 **정직하게 비어있다고 말해야** 하며, 오류로 둔갓하면 그것이야말로 거짓말이다.
  const isLegitimatelyEmpty = stableTotal && totalCount === 0 && rawFetched === 0;
  const windowExact = isLegitimatelyEmpty || (windowLength > 0 && offendingAttractions.length === 0);

  const complete = stableTotal && rawExact && uniqueExact && windowExact;

  let failureReason: string | undefined;
  if (!complete) {
    const reasons: string[] = [];
    if (!stableTotal) reasons.push(`totalCount unstable across pages (saw ${[...totalCounts].join(", ")})`);
    if (stableTotal && !rawExact) reasons.push(`rawFetched (${rawFetched}) != totalCount (${totalCount})`);
    if (stableTotal && !uniqueExact) reasons.push(`uniqueFetched (${uniqueFetched}) != totalCount (${totalCount}) — likely (tAtsNm, baseYmd) key collision`);
    if (!windowExact) {
      reasons.push(
        windowLength === 0
          ? `no dated rows returned although totalCount is ${totalCount}`
          : `${offendingAttractions.length} attraction(s) have row count != window length (${windowLength})`
      );
    }
    failureReason = reasons.join("; ");
  }

  return {
    stableTotal,
    rawExact,
    uniqueExact,
    windowExact,
    complete,
    totalCount,
    rawFetched,
    uniqueFetched,
    pages,
    windowLength,
    offendingAttractions,
    failureReason,
  };
}

function buildFailedIntegrity(rawItems: TatsCnctrItem[], totalCounts: Set<number>, pages: number, reason: string): CollectIntegrity {
  const base = buildIntegrity(rawItems, totalCounts, pages);
  return { ...base, complete: false, failureReason: reason };
}
