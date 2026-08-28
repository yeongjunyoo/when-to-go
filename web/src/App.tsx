import { useEffect, useState } from "react";
import { fetchSidoList, SidoRegion, ProxyError } from "./proxyClient";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; regions: SidoRegion[]; fetchedAt: number; cacheHit: boolean };

export default function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchSidoList()
      .then((result) => {
        if (!cancelled) setState({ status: "success", ...result });
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof ProxyError ? err.message : "알 수 없는 오류가 발생했습니다";
          setState({ status: "error", message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-50 px-4 py-6 text-gray-900">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">언제 가지</h1>
        <p className="mt-1 text-sm text-gray-500">공공데이터 기반 관광 혼잡도 안내 (배포 스모크 화면)</p>
      </header>

      <section aria-label="시도 목록 스모크 테스트">
        <h2 className="mb-2 text-lg font-semibold">시도 목록 (프록시 실호출 확인)</h2>

        {state.status === "loading" && (
          <div role="status" className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            불러오는 중…
          </div>
        )}

        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            오류: {state.message}
          </div>
        )}

        {state.status === "success" && (
          <div>
            <p className="mb-2 text-xs text-gray-500">
              {state.regions.length}개 시도 · {state.cacheHit ? "캐시됨" : "실호출"} · 기준시각{" "}
              {new Date(state.fetchedAt).toLocaleString("ko-KR")}
            </p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {state.regions.map((region) => (
                <li key={region.code} className="rounded-md border border-gray-200 bg-white p-2 text-sm">
                  {region.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
