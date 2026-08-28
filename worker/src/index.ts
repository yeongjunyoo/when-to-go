import { OPERATIONS, UPSTREAM_HOST } from "./allowlist";
import { validateRequest, ValidationError } from "./validate";
import { assertCircuitOpen, recordUpstreamCall, circuitStatus, CIRCUIT_WARN_THRESHOLD, CIRCUIT_BLOCK_THRESHOLD } from "./circuit";
import { cacheGet, cacheSet, buildCacheKey } from "./cache";
import { isRateLimited } from "./rate-limit";
import { redactUrl, redactText } from "./redact";
import { recordHistory, summarizeHistory } from "./history";
import { collectTatsCnctrRatedList } from "./collect";
import { collectPoiIndex } from "./poi";
import { fetchRelatedTop5 } from "./related";

export interface Env {
  TOURAPI_KEY: string;
  UPSTREAM_BASE: string;
}

const MOBILE_APP = "언제가지";
const MOBILE_OS = "ETC";

// 이 프록시는 쿼터가 제한된(개발계정 1,000콜/일) 인증키를 들고 있다.
// 따라서 CORS를 와일드카드로 열지 않고 자사 배포 오리진만 허용한다.
// ⚠️ CORS는 남용 경계가 아니다(브라우저 밖 호출은 막지 못한다) — 실제 방어는
// rate limit·서킷 브레이커·allowlist이고, 이건 정상 브라우저 경로를 열어주는 장치다.
// ⚠️ 선행 점이 있는 항목만 둔다. 점 없는 `"when-to-go-7s6.pages.dev"`를 `endsWith`로
// 검사하면 레이블 경계가 없어 `evilwhen-to-go-7s6.pages.dev`가 통과한다.
// Pages 프로젝트명은 셀프서비스라 공격자가 그 호스트명을 실제로 등록해
// 공유 쿼터(1,000/일)를 소모시킬 수 있다. apex 도메인은 ALLOWED_ORIGINS_EXACT가 덤는다.
const ALLOWED_ORIGIN_SUFFIXES = [".when-to-go-7s6.pages.dev"];
const ALLOWED_ORIGINS_EXACT = ["https://when-to-go-7s6.pages.dev", "http://localhost:5173", "http://127.0.0.1:5173"];

function resolveAllowedOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  if (ALLOWED_ORIGINS_EXACT.includes(origin)) return origin;
  try {
    const host = new URL(origin).hostname;
    // Pages 프리뷰 배포(<hash>.when-to-go-7s6.pages.dev)도 같은 프로젝트라 허용한다.
    if (ALLOWED_ORIGIN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix))) return origin;
  } catch {
    return undefined;
  }
  return undefined;
}

function corsHeaders(request: Request): Record<string, string> {
  const allowed = resolveAllowedOrigin(request);
  if (!allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function clientIpFromRequest(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
}

async function handleProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const operation = url.searchParams.get("operation") ?? "";

  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }

  let validated;
  try {
    validated = validateRequest(operation, url.searchParams);
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse({ error: "invalid_request", field: err.field, message: err.message }, 400);
    }
    throw err;
  }

  const spec = OPERATIONS[validated.operation];
  const cacheParams: Record<string, string> = {
    ...validated.extraParams,
    numOfRows: String(validated.numOfRows),
    pageNo: String(validated.pageNo),
  };
  const cacheKey = buildCacheKey(validated.operation, cacheParams);

  const cached = cacheGet<UpstreamSuccessPayload>(cacheKey);
  if (cached) {
    return jsonResponse({ ...cached.value, fetchedAt: cached.fetchedAt, cacheHit: true }, 200, circuitHeaders());
  }

  let circuitState;
  try {
    circuitState = assertCircuitOpen();
  } catch (err) {
    return jsonResponse({ error: "circuit_open", message: (err as Error).message }, 503);
  }

  const upstreamUrl = new URL(spec.path, env.UPSTREAM_BASE);
  upstreamUrl.searchParams.set("serviceKey", env.TOURAPI_KEY);
  upstreamUrl.searchParams.set("MobileApp", MOBILE_APP);
  upstreamUrl.searchParams.set("MobileOS", MOBILE_OS);
  upstreamUrl.searchParams.set("_type", "json");
  upstreamUrl.searchParams.set("numOfRows", String(validated.numOfRows));
  upstreamUrl.searchParams.set("pageNo", String(validated.pageNo));
  for (const [key, value] of Object.entries(validated.extraParams)) {
    upstreamUrl.searchParams.set(key, value);
  }

  let upstreamRes: Response;
  const today = kstDay();
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), { method: "GET" });
  } catch (err) {
    recordUpstreamCall();
    recordHistory({ day: today, operation: validated.operation, mobileApp: MOBILE_APP, resultCode: "ERROR" });
    return jsonResponse({ error: "upstream_fetch_failed", message: redactText(String((err as Error).message ?? err)) }, 502);
  }
  recordUpstreamCall();

  let bodyJson: unknown;
  try {
    bodyJson = await upstreamRes.json();
  } catch {
    recordHistory({ day: today, operation: validated.operation, mobileApp: MOBILE_APP, resultCode: "ERROR" });
    return jsonResponse({ error: "upstream_bad_response", message: "upstream did not return valid JSON" }, 502);
  }

  const resultCode = extractResultCode(bodyJson);
  recordHistory({ day: today, operation: validated.operation, mobileApp: MOBILE_APP, resultCode: resultCode ?? "ERROR" });

  if (!upstreamRes.ok || resultCode !== "0000") {
    // Never cache errors/partial responses.
    return jsonResponse(
      { error: "upstream_error", upstreamStatus: upstreamRes.status, resultCode: resultCode ?? null, message: "upstream returned a non-success result" },
      502
    );
  }

  const payload: UpstreamSuccessPayload = { data: bodyJson };
  cacheSet(cacheKey, payload);
  const fetchedAt = Date.now();

  return jsonResponse({ ...payload, fetchedAt, cacheHit: false }, 200, circuitHeaders(circuitState.status));
}

interface UpstreamSuccessPayload {
  data: unknown;
}

/**
 * /api/collect?operation=tatsCnctrRatedList&areaCd=..&signguCd=..
 * Fully paginates upstream (page size fixed at 1000) and returns the whole
 * result plus a hard completeness verdict (`integrity`). Never silently
 * returns a partial collection as if it were complete.
 */
async function handleCollect(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const operation = url.searchParams.get("operation") ?? "";

  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }

  if (operation !== "tatsCnctrRatedList") {
    return jsonResponse({ error: "invalid_request", field: "operation", message: 'only "tatsCnctrRatedList" supports full collection' }, 400);
  }

  const areaCd = url.searchParams.get("areaCd") ?? "";
  const signguCd = url.searchParams.get("signguCd") ?? "";
  if (!/^\d{2}$/.test(areaCd)) {
    return jsonResponse({ error: "invalid_request", field: "areaCd", message: "areaCd must be exactly 2 digits" }, 400);
  }
  if (!/^\d{5}$/.test(signguCd)) {
    return jsonResponse({ error: "invalid_request", field: "signguCd", message: "signguCd must be exactly 5 digits" }, 400);
  }

  const cacheKey = buildCacheKey("tatsCnctrRatedList:collect", { areaCd, signguCd });
  const cached = cacheGet<CollectPayload>(cacheKey);
  if (cached) {
    return jsonResponse({ ...cached.value, fetchedAt: cached.fetchedAt, cacheHit: true }, 200, circuitHeaders());
  }

  const { items, integrity } = await collectTatsCnctrRatedList(areaCd, signguCd, env);

  if (!integrity.complete) {
    // Never cache an incomplete collection, and never disguise it as success.
    return jsonResponse({ error: "incomplete_collection", integrity, itemsFetched: items.length }, 502, circuitHeaders());
  }

  const payload: CollectPayload = { items, integrity };
  cacheSet(cacheKey, payload);
  const fetchedAt = Date.now();
  return jsonResponse({ ...payload, fetchedAt, cacheHit: false }, 200, circuitHeaders());
}

interface CollectPayload {
  items: unknown[];
  integrity: unknown;
}

/**
 * /api/collect/stream?operation=tatsCnctrRatedList&areaCd=..&signguCd=..
 * Progressive-render companion to /api/collect. Measured real (cache-miss)
 * collection time for 제주시 (8 pages) is ~5s — right at the acceptance
 * threshold — so large sigungu need a way to show collected pages before
 * the full response lands, WITHOUT ever omitting an attraction or
 * truncating to a top-N (hard rule). This route reuses the EXACT SAME
 * collectTatsCnctrRatedList()/completeness-invariant logic as /api/collect
 * (via its onPage hook) — it changes only how results are DELIVERED
 * (streamed NDJSON lines instead of one JSON blob), never what counts as
 * complete. Not cached (streaming responses aren't cacheable the same way).
 */
async function handleCollectStream(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const operation = url.searchParams.get("operation") ?? "";

  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }

  if (operation !== "tatsCnctrRatedList") {
    return jsonResponse({ error: "invalid_request", field: "operation", message: 'only "tatsCnctrRatedList" supports streaming collection' }, 400);
  }

  const areaCd = url.searchParams.get("areaCd") ?? "";
  const signguCd = url.searchParams.get("signguCd") ?? "";
  if (!/^\d{2}$/.test(areaCd)) {
    return jsonResponse({ error: "invalid_request", field: "areaCd", message: "areaCd must be exactly 2 digits" }, 400);
  }
  if (!/^\d{5}$/.test(signguCd)) {
    return jsonResponse({ error: "invalid_request", field: "signguCd", message: "signguCd must be exactly 5 digits" }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const { integrity } = await collectTatsCnctrRatedList(areaCd, signguCd, env, (pageItems, pageNo, totalCount) => {
          send({ type: "page", pageNo, totalCount, items: pageItems });
        });
        // Same completeness verdict as /api/collect, delivered as the final
        // line — never claim success unless every invariant genuinely held.
        send(integrity.complete ? { type: "done", integrity } : { type: "incomplete", integrity });
      } catch (err) {
        send({ type: "error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}

/**
 * /api/poi?lDongRegnCd=..&lDongSignguCd=..
 * Fully paginates areaBasedList2 for a single sigungu — the B-live entity
 * resolution candidate index. Same completeness discipline as /api/collect:
 * an incomplete POI set is never disguised as a successful (possibly
 * empty-looking) candidate pool.
 */
async function handlePoi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }

  const lDongRegnCd = url.searchParams.get("lDongRegnCd") ?? "";
  const lDongSignguCd = url.searchParams.get("lDongSignguCd") ?? "";
  if (!/^\d{2}$/.test(lDongRegnCd)) {
    return jsonResponse({ error: "invalid_request", field: "lDongRegnCd", message: "lDongRegnCd must be exactly 2 digits" }, 400);
  }
  if (!/^\d{3}$/.test(lDongSignguCd)) {
    return jsonResponse({ error: "invalid_request", field: "lDongSignguCd", message: "lDongSignguCd must be exactly 3 digits" }, 400);
  }

  const cacheKey = buildCacheKey("areaBasedList2:poi", { lDongRegnCd, lDongSignguCd });
  const cached = cacheGet<PoiPayload>(cacheKey);
  if (cached) {
    return jsonResponse({ ...cached.value, fetchedAt: cached.fetchedAt, cacheHit: true }, 200, circuitHeaders());
  }

  const poiResult = await collectPoiIndex(lDongRegnCd, lDongSignguCd, env);

  if (!poiResult.complete) {
    return jsonResponse({ error: "incomplete_poi_collection", failureReason: poiResult.failureReason, itemsFetched: poiResult.items.length }, 502, circuitHeaders());
  }

  const payload: PoiPayload = { items: poiResult.items, totalCount: poiResult.totalCount, pages: poiResult.pages };
  cacheSet(cacheKey, payload);
  const fetchedAt = Date.now();
  return jsonResponse({ ...payload, fetchedAt, cacheHit: false }, 200, circuitHeaders());
}

interface PoiPayload {
  items: unknown[];
  totalCount: number | null;
  pages: number;
}

/**
 * /api/related?areaCd=..&signguCd=..&baseYm=..
 * Top-5 rlteRank rows from areaBasedList1. Some sigungu (경기도 화성시)
 * legitimately have zero related rows — that must render as an explicit
 * empty state, not silently as "still loading".
 */
async function handleRelated(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }

  const areaCd = url.searchParams.get("areaCd") ?? "";
  const signguCd = url.searchParams.get("signguCd") ?? "";
  const baseYm = url.searchParams.get("baseYm") ?? "";
  if (!/^\d{2}$/.test(areaCd)) {
    return jsonResponse({ error: "invalid_request", field: "areaCd", message: "areaCd must be exactly 2 digits" }, 400);
  }
  if (!/^\d{5}$/.test(signguCd)) {
    return jsonResponse({ error: "invalid_request", field: "signguCd", message: "signguCd must be exactly 5 digits" }, 400);
  }
  if (!/^\d{6}$/.test(baseYm)) {
    return jsonResponse({ error: "invalid_request", field: "baseYm", message: "baseYm must be YYYYMM (6 digits)" }, 400);
  }

  const cacheKey = buildCacheKey("areaBasedList1:related", { areaCd, signguCd, baseYm });
  const cached = cacheGet<RelatedPayload>(cacheKey);
  if (cached) {
    return jsonResponse({ ...cached.value, fetchedAt: cached.fetchedAt, cacheHit: true }, 200, circuitHeaders());
  }

  const result = await fetchRelatedTop5(areaCd, signguCd, baseYm, env);
  if ("error" in result) {
    return jsonResponse({ error: "upstream_error", message: "failed to fetch related attractions" }, 502, circuitHeaders());
  }

  const payload: RelatedPayload = { items: result.items, empty: result.empty, totalCount: result.totalCount };
  cacheSet(cacheKey, payload);
  const fetchedAt = Date.now();
  return jsonResponse({ ...payload, fetchedAt, cacheHit: false }, 200, circuitHeaders());
}

interface RelatedPayload {
  items: unknown[];
  empty: boolean;
  totalCount: number | null;
}

/**
 * /api/observability
 * L4 관측성 엔드포인트 — 1차 심사의 "실제 호출 내역 대조 검증"에 직접 대응한다.
 * 오퍼레이션별·일별 호출 수·응답코드 분포(history.ts, 키 제외) + 서킷브레이커 상태를
 * 하나의 응답으로 묶는다. 이 자체도 공개 프록시 엔드포인트라 CORS·rate limit 적용 대상이다.
 */
async function handleObservability(request: Request): Promise<Response> {
  const clientIp = clientIpFromRequest(request);
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429);
  }
  const circuit = circuitStatus();
  return jsonResponse(
    {
      circuit: { status: circuit.status, count: circuit.count, day: circuit.day, warnThreshold: CIRCUIT_WARN_THRESHOLD, blockThreshold: CIRCUIT_BLOCK_THRESHOLD },
      callHistory: summarizeHistory(),
    },
    200
  );
}

function circuitHeaders(status?: string): Record<string, string> {
  const s = status ?? circuitStatus().status;
  const headers: Record<string, string> = {};
  if (s === "warn") headers["x-circuit-status"] = `warn (approaching ${CIRCUIT_WARN_THRESHOLD}-call daily notice threshold)`;
  if (s === "blocked") headers["x-circuit-status"] = `blocked (>= ${CIRCUIT_BLOCK_THRESHOLD} calls today)`;
  return headers;
}

function extractResultCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const header = response?.header as Record<string, unknown> | undefined;
  const code = header?.resultCode;
  return typeof code === "string" ? code : undefined;
}

function kstDay(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kstNow.toISOString().slice(0, 10);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    // 브라우저 preflight. 허용 오리진이 아니면 CORS 헤더 없이 204를 돌려줘
    // 브라우저가 알아서 차단하게 한다.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "method_not_allowed" }, 405, cors);
    }

    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true, upstreamHost: UPSTREAM_HOST }, 200, cors);
    }

    if (url.pathname === "/api/observability") {
      try {
        const response = await handleObservability(request);
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    if (url.pathname === "/api/collect") {
      try {
        const response = await handleCollect(request, env);
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    if (url.pathname === "/api/collect/stream") {
      try {
        const response = await handleCollectStream(request, env);
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    if (url.pathname === "/api/poi") {
      try {
        const response = await handlePoi(request, env);
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    if (url.pathname === "/api/related") {
      try {
        const response = await handleRelated(request, env);
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    if (url.pathname === "/api/proxy") {
      try {
        const response = await handleProxy(request, env);
        // handleProxy가 만든 응답에 CORS 헤더를 입힌다(성공·오류 경로 공통).
        if (Object.keys(cors).length === 0) return response;
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      } catch (err) {
        // Redact defensively: never let a raw error containing the URL/key leak.
        return jsonResponse({ error: "internal_error", message: redactText(String((err as Error).message ?? err), env.TOURAPI_KEY) }, 500, cors);
      }
    }

    return jsonResponse({ error: "not_found" }, 404, cors);
  },
};

// Exported only for tests that want to sanity-check URL redaction behavior end to end.
export { redactUrl };
