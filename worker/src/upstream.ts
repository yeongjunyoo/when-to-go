// Shared single-page upstream fetch, extracted so both the pass-through
// /api/proxy route and the full-pagination /api/collect route go through
// the exact same secret-injection / circuit-breaker / history / redaction
// path. There must be only one place that builds an upstream request.
import { OPERATIONS, OperationName } from "./allowlist";
import { assertCircuitOpen, recordUpstreamCall } from "./circuit";
import { recordHistory } from "./history";
import { redactText } from "./redact";

export const MOBILE_APP = "언제가지";
export const MOBILE_OS = "ETC";

export interface UpstreamEnv {
  TOURAPI_KEY: string;
  UPSTREAM_BASE: string;
}

export interface UpstreamPageParams {
  operation: OperationName;
  extraParams: Record<string, string>;
  numOfRows: number;
  pageNo: number;
}

export interface UpstreamPageSuccess {
  ok: true;
  body: unknown;
}
export interface UpstreamPageFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
}
export type UpstreamPageResult = UpstreamPageSuccess | UpstreamPageFailure;

export async function fetchUpstreamPage(params: UpstreamPageParams, env: UpstreamEnv): Promise<UpstreamPageResult> {
  try {
    assertCircuitOpen();
  } catch (err) {
    return { ok: false, status: 503, error: "circuit_open", message: (err as Error).message };
  }

  const spec = OPERATIONS[params.operation];
  const upstreamUrl = new URL(spec.path, env.UPSTREAM_BASE);
  upstreamUrl.searchParams.set("serviceKey", env.TOURAPI_KEY);
  upstreamUrl.searchParams.set("MobileApp", MOBILE_APP);
  upstreamUrl.searchParams.set("MobileOS", MOBILE_OS);
  upstreamUrl.searchParams.set("_type", "json");
  upstreamUrl.searchParams.set("numOfRows", String(params.numOfRows));
  upstreamUrl.searchParams.set("pageNo", String(params.pageNo));
  for (const [key, value] of Object.entries(params.extraParams)) {
    upstreamUrl.searchParams.set(key, value);
  }

  const today = kstDay();
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), { method: "GET" });
  } catch (err) {
    recordUpstreamCall();
    recordHistory({ day: today, operation: params.operation, mobileApp: MOBILE_APP, resultCode: "ERROR" });
    return { ok: false, status: 502, error: "upstream_fetch_failed", message: redactText(String((err as Error).message ?? err)) };
  }
  recordUpstreamCall();

  let bodyJson: unknown;
  try {
    bodyJson = await upstreamRes.json();
  } catch {
    recordHistory({ day: today, operation: params.operation, mobileApp: MOBILE_APP, resultCode: "ERROR" });
    return { ok: false, status: 502, error: "upstream_bad_response", message: "upstream did not return valid JSON" };
  }

  const resultCode = extractResultCode(bodyJson);
  recordHistory({ day: today, operation: params.operation, mobileApp: MOBILE_APP, resultCode: resultCode ?? "ERROR" });

  if (!upstreamRes.ok || resultCode !== "0000") {
    return { ok: false, status: 502, error: "upstream_error", message: "upstream returned a non-success result" };
  }

  return { ok: true, body: bodyJson };
}

export function extractResultCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const anyBody = body as Record<string, unknown>;
  const response = anyBody.response as Record<string, unknown> | undefined;
  const header = response?.header as Record<string, unknown> | undefined;
  const code = header?.resultCode;
  return typeof code === "string" ? code : undefined;
}

export function kstDay(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kstNow.toISOString().slice(0, 10);
}
