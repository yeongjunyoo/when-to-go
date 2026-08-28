import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { Env } from "../worker/src/index";
import { resetCircuitForTests } from "../worker/src/circuit";
import { cacheClearForTests } from "../worker/src/cache";
import { rateLimitClearForTests } from "../worker/src/rate-limit";
import { historyClearForTests } from "../worker/src/history";
import { PAGE_SIZE } from "../worker/src/collect";
import { isSejong, SEJONG_LDONG_CODE, normalizeRegnCd, toSignguCd } from "../worker/src/region-codes";
import { buildCalendar, recommendedDays, computeDateRange, computeFreshness, formatYmd } from "../web/src/attractionAnalysis";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const FAKE_KEY = "FAKE_TEST_SERVICE_KEY_0000000000000000000000000000000000000000";
const env: Env = { TOURAPI_KEY: FAKE_KEY, UPSTREAM_BASE: "https://apis.data.go.kr/B551011/" };

function tatsItem(tAtsNm: string, baseYmd: string, cnctrRate: string | number = "50") {
  return { baseYmd, areaCd: "51", areaNm: "강원", signguCd: "51110", signguNm: "춘천시", tAtsNm, cnctrRate };
}

function upstreamOk(items: unknown[], totalCount: number) {
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

function req(path_: string, query: string, ip = "1.2.3.4"): Request {
  return new Request(`https://proxy.example.com${path_}?${query}`, { headers: { "cf-connecting-ip": ip } });
}

describe("L3 시나리오 1: 지역 선택 → 목록 → 캘린더 → 추천 3일 완주", () => {
  it("A2 수집 → A3 캘린더 → A4 배지/추천 3일까지 파이프라인 전체가 일관된 데이터로 동작한다", async () => {
    const items = [
      tatsItem("남이섬", "20260828", "10"),
      tatsItem("남이섬", "20260829", "50"),
      tatsItem("남이섬", "20260830", "20"),
      tatsItem("남이섬", "20260831", "5"),
    ];
    fetchSpy.mockResolvedValueOnce(upstreamOk(items, 4));
    const res = await worker.fetch(req("/api/collect", "operation=tatsCnctrRatedList&areaCd=51&signguCd=51110"), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.integrity.complete).toBe(true);

    const attractionRows = body.items.filter((r: { tAtsNm: string }) => r.tAtsNm === "남이섬");
    const calendar = buildCalendar(attractionRows);
    expect(calendar).toHaveLength(4);

    const recs = recommendedDays(calendar);
    // 하위 3일: 5, 10, 20 (20260831, 20260828, 20260830)
    expect(recs.map((r) => r.baseYmd)).toEqual(["20260831", "20260828", "20260830"]);
  });
});

describe("L3 시나리오 2: 세종 terminal node (시군구 단계 생략)", () => {
  it("ldongCode2 목록에서 세종(36110)을 만나면 시군구 조회 없이 바로 A2로 진입한다", () => {
    expect(isSejong(SEJONG_LDONG_CODE)).toBe(true);
    // 세종은 areaCd=36, signguCd=36110으로 바로 조립되어 A2(tatsCnctrRatedList)를 호출할 수 있다.
    const normalized = normalizeRegnCd(SEJONG_LDONG_CODE);
    expect(normalized).toBe("36");
    expect(toSignguCd(normalized, "110")).toBe("36110");
  });

  it("세종이 아닌 시도는 시군구 선택 단계를 반드시 거친다", () => {
    expect(isSejong("11")).toBe(false); // 서울 — 정상 시군구 선택 필요
  });
});

describe("L3 시나리오 3: 제주 244곳 완전 페이징 + 점진 렌더 중 수집 중 표시", () => {
  it("8페이지 전량 수집 후 244곳(실측 스냅샷 근사)이 관광지 누락 없이 완성된다", async () => {
    // 실측 규모를 축소 재현: 2페이지 x 500행으로 완전 페이징 로직만 검증(쿼터 절약).
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => tatsItem(`제주관광지${i}`, "20260828"));
    const page2 = Array.from({ length: PAGE_SIZE }, (_, i) => tatsItem(`제주관광지${i}`, "20260829"));
    fetchSpy.mockResolvedValueOnce(upstreamOk(page1, 2000)).mockResolvedValueOnce(upstreamOk(page2, 2000));

    const res = await worker.fetch(req("/api/collect/stream", "operation=tatsCnctrRatedList&areaCd=50&signguCd=50110"), env);
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

    const pageLines = lines.filter((l) => l.type === "page");
    expect(pageLines).toHaveLength(2); // 점진 렌더: 페이지별로 개별 이벤트

    const doneLine = lines.find((l) => l.type === "done");
    expect(doneLine.integrity.complete).toBe(true);
    expect(doneLine.integrity.rawFetched).toBe(2000); // 관광지 누락 없음
  });
});

describe("L3 시나리오 4: 업스트림 갱신 동결 재현 (21일/16일 축소 스텁)", () => {
  it("(a) A5 날짜범위가 실제 응답 값으로 표시된다 — 21일 동결 재현", () => {
    const rows = [];
    let d = new Date(Date.UTC(2026, 7, 24)); // 2026-08-24
    for (let i = 0; i < 21; i++) {
      const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
      rows.push({ baseYmd: ymd, tAtsNm: "테스트", cnctrRate: 50 });
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
    const range = computeDateRange(rows);
    expect(range?.windowLength).toBe(21); // 하드코딩된 30이 아니라 실제 21
    expect(range?.min).toBe("20260824");
    expect(range?.max).toBe("20260913"); // 실측 동결 종료일
  });

  it("(b) 신선도 배지가 노출된다 — 16일 축소 스냅샷", () => {
    const range = { min: "20260829", max: "20260913", windowLength: 16 };
    const collectedAt = Date.UTC(2026, 7, 28, 0, 20, 1);
    const verdict = computeFreshness(range, collectedAt);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("short_window");
  });

  it("(c) 추천 3일이 여전히 성립한다 — 축소된 창에서도 자기 날짜열 기준으로 정상 동작", () => {
    const calendar = [
      { baseYmd: "20260824", cnctrRate: 30 },
      { baseYmd: "20260825", cnctrRate: 10 },
      { baseYmd: "20260826", cnctrRate: 20 },
      { baseYmd: "20260827", cnctrRate: 40 },
    ];
    const recs = recommendedDays(calendar);
    expect(recs).toHaveLength(3);
    expect(recs[0].baseYmd).toBe("20260825"); // 최저값(10)이 여전히 1순위
  });

  it("(d) 어디에도 '오늘 기준' 문구가 없다 — formatYmd/신선도 문구는 실제 날짜만 표기한다", () => {
    // formatYmd는 하드코딩된 상대 표현("오늘", "오늘 기준") 없이 절대 날짜(YYYY-MM-DD)만 반환한다.
    expect(formatYmd("20260913")).toBe("2026-09-13");
    expect(formatYmd("20260913")).not.toMatch(/오늘/);

    // AttractionDetail.tsx의 신선도 배지 문구 자체를 소스에서 검증 — "오늘 기준"이라는
    // 표현이 등장하면 사용자가 동결된 데이터를 최신으로 오인할 위험이 있다.
    const detailSource = readFileSync(path.join(__dirname, "../web/src/AttractionDetail.tsx"), "utf8");
    expect(detailSource).not.toMatch(/오늘\s*기준/);
    expect(detailSource).toMatch(/데이터 최종 갱신/); // 대신 "데이터 최종 갱신 YYYY-MM-DD 기준"을 쓴다
  });
});

describe("L3 시나리오 5: 금지어 0건 (렌더 DOM 전체)", () => {
  it("web/src 전체 소스에 금지어가 없다 (렌더되는 모든 컴포넌트 포함)", () => {
    const FORBIDDEN = [/한국관광공사/, /\bKTO\b/, /Korea Tourism/i];
    const root = path.join(__dirname, "../web/src");
    const violations: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(full, "utf8");
          for (const pattern of FORBIDDEN) {
            if (pattern.test(content)) violations.push(`${full}: ${pattern}`);
          }
        }
      }
    }
    walk(root);
    expect(violations).toEqual([]);
  });

  it("빌드된 web/dist가 있으면 그 안에도 금지어가 없다", () => {
    const distDir = path.join(__dirname, "../web/dist");
    let exists = true;
    try {
      statSync(distDir);
    } catch {
      exists = false;
    }
    if (!exists) return; // 빌드 전이면 생략 — check:terms가 별도로 강제한다
    const FORBIDDEN = [/한국관광공사/, /\bKTO\b/, /Korea Tourism/i];
    const violations: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(js|html|css)$/.test(entry)) {
          const content = readFileSync(full, "utf8");
          for (const pattern of FORBIDDEN) {
            if (pattern.test(content)) violations.push(`${full}: ${pattern}`);
          }
        }
      }
    }
    walk(distDir);
    expect(violations).toEqual([]);
  });
});
