import { OPERATIONS, UPSTREAM_HOST } from "./allowlist";
import { validateRequest, ValidationError } from "./validate";
import { assertCircuitOpen, recordUpstreamCall, circuitStatus, CIRCUIT_WARN_THRESHOLD, CIRCUIT_BLOCK_THRESHOLD } from "./circuit";
import { cacheGet, cacheSet, buildCacheKey } from "./cache";
import { isRateLimited } from "./rate-limit";
import { redactUrl, redactText } from "./redact";
import { recordHistory } from "./history";

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
const ALLOWED_ORIGIN_SUFFIXES = [".when-to-go-7s6.pages.dev", "when-to-go-7s6.pages.dev"];
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
