import type { RelatedAttractionRow } from "./proxyClient";

export type RelatedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "success"; items: RelatedAttractionRow[] };

/**
 * 업스트림 rlteRank 는 **기준 관광지별** 순위다. 시군구의 여러 기준 관광지에서
 * 모은 행을 한 줄로 합치면 rank 1 이 여럿 나오고 같은 장소가 겹쳐 들어온다.
 * 그래서 순위 숫자를 표시하지 않는다 — 전역 순위가 아닌 값을 「1위」처럼 보여주면
 * 사실이 아닌 서열을 주장하게 된다. 이름 기준으로 중복만 걷어내고 나열한다.
 */
export function dedupeByName(items: RelatedAttractionRow[]): RelatedAttractionRow[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.name.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Name-only related-attraction display. Deliberately does NOT link to POI
 * detail — see worker/src/related.ts for why (cross-sigungu targets, low
 * candidate discovery rate).
 */
export default function RelatedSection({ state }: { state: RelatedState }) {
  if (state.status === "idle") return null;

  return (
    <section aria-label="연관 관광지" className="mb-6">
      <h2 className="mb-2 text-lg font-semibold">여기 다음에 실제로 간 곳</h2>
      {state.status === "loading" && (
        <div role="status" className="rounded-lg border border-default bg-surface p-4 text-sm text-text-muted">
          불러오는 중…
        </div>
      )}
      {state.status === "error" && (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-fg">
          오류: {state.message}
        </div>
      )}
      {state.status === "empty" && (
        <div role="status" className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn-fg">
          이 시군구는 연관 관광지 데이터가 없습니다.
        </div>
      )}
      {state.status === "success" && (
        <ul className="divide-y divide-default rounded-md border border-default bg-surface text-sm">
          {dedupeByName(state.items).map((item) => (
            <li key={item.name} className="p-3">
              {item.name}{" "}
              <span className="text-xs text-text-subtle">
                ({item.category}, {item.signguName})
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
