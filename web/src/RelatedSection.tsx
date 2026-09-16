import type { RelatedAttractionRow } from "./proxyClient";

export type RelatedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "success"; items: RelatedAttractionRow[] };

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
          {state.items.map((item) => (
            <li key={`${item.rank}-${item.name}`} className="p-2">
              {item.rank}. {item.name} <span className="text-xs text-text-subtle">({item.category}, {item.signguName})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
