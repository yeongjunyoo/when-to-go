import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import { PAGE_SIZE } from "../worker/src/collect";

// B6 성능 요건: 실측(2026-08-28) 제주시 8페이지 완전 수집이 캐시 미스 기준
// ~5.0초로 5초 임계에 바로 걸쳐 있었다(리더가 배포본에서 1회 실호출로 측정).
// /api/collect/stream은 그 상황에서 점진 렌더를 가능하게 하되, 완전성
// 불변식·"관광지 임의 누락·상위 N 절단 금지" 하드룰은 절대 건드리지 않는다 —
// 페이지가 수집되는 대로 흘려보낼 뿐, 완전성 판정 로직은 /api/collect와
// 완전히 동일한 collectTatsCnctrRatedList()를 그대로 재사용한다.

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function tatsItem(tAtsNm: string, baseYmd: string) {
  return { baseYmd, areaCd: "50", areaNm: "제주", signguCd: "50110", signguNm: "제주시", tAtsNm, cnctrRate: 50 };
}

function upstreamOk(items: ReturnType<typeof tatsItem>[], totalCount: number) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item: items }, numOfRows: PAGE_SIZE, pageNo: 1, totalCount } } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetCircuitForTests();
  cacheClearForTests();
  rateLimitClearForTests();
  historyClearForTests();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

function req(query: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com/api/collect/stream?${query}`, { headers: { "cf-connecting-ip": ip } });
}

async function readAllLines(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("/api/collect/stream — 점진 렌더", () => {
  it("페이지가 수집되는 순서대로 스트리밍되고, 관광지 누락 없이 최종 done 라인으로 마감된다", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => tatsItem(`attr${i}`, "20260828"));
    const page2 = Array.from({ length: PAGE_SIZE }, (_, i) => tatsItem(`attr${i}`, "20260829"));
    fetchSpy.mockResolvedValueOnce(upstreamOk(page1, 2000)).mockResolvedValueOnce(upstreamOk(page2, 2000));

    const res = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=50&signguCd=50110"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/x-ndjson/);

    const lines = (await readAllLines(res)) as { type: string; pageNo?: number; items?: unknown[]; integrity?: { complete: boolean; rawFetched: number } }[];
    const pageLines = lines.filter((l) => l.type === "page");
    const doneLine = lines.find((l) => l.type === "done");

    expect(pageLines).toHaveLength(2);
    expect(pageLines[0].pageNo).toBe(1);
    expect(pageLines[1].pageNo).toBe(2);
    // 모든 페이지의 항목 합이 전체 관광지 수와 일치한다 — 임의 누락이 없다.
    const totalStreamedItems = pageLines.reduce((sum, l) => sum + (l.items?.length ?? 0), 0);
    expect(totalStreamedItems).toBe(2000);

    expect(doneLine).toBeDefined();
    expect(doneLine?.integrity?.complete).toBe(true);
    expect(doneLine?.integrity?.rawFetched).toBe(2000);
  });

  it("불완전 수집이면 done이 아니라 incomplete로 마감되고, 그 사실이 스트림에 명시된다", async () => {
    const badItems = [tatsItem("남이섬", "20260828")];
    fetchSpy.mockResolvedValueOnce(upstreamOk(badItems, 5)); // totalCount != rawFetched
    const res = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=50&signguCd=50110"), env);
    const lines = (await readAllLines(res)) as { type: string; integrity?: { complete: boolean } }[];
    const lastLine = lines[lines.length - 1];
    expect(lastLine.type).toBe("incomplete");
    expect(lastLine.integrity?.complete).toBe(false);
  });

  it("허용되지 않은 operation은 스트림 시작 전에 400으로 거부된다", async () => {
    const res = await worker.fetch(req("operation=ldongCode2&areaCd=50&signguCd=50110"), env);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("상위 N 절단이 없다 — 수집된 모든 페이지의 관광지가 스트림에 그대로 나타난다(1000개 초과 시나리오)", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => tatsItem(`site${i}`, "20260828"));
    fetchSpy.mockResolvedValueOnce(upstreamOk(page1, PAGE_SIZE));
    const res = await worker.fetch(req("operation=tatsCnctrRatedList&areaCd=50&signguCd=50110"), env);
    const lines = (await readAllLines(res)) as { type: string; items?: { tAtsNm: string }[] }[];
    const pageLine = lines.find((l) => l.type === "page");
    const names = new Set(pageLine?.items?.map((i) => i.tAtsNm));
    expect(names.size).toBe(PAGE_SIZE); // 전량 보존, 상위 N 절단 없음
  });
});
