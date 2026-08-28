import { OPERATIONS, OperationName, ParamKind } from "./allowlist";

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
    this.name = "ValidationError";
  }
}

// Forbidden client-supplied params: these are ALWAYS server-injected.
export const FORBIDDEN_CLIENT_PARAMS = ["serviceKey", "MobileApp", "MobileOS", "_type"] as const;

const DIGIT_LEN: Partial<Record<ParamKind, number>> = {
  areaCd: 2,
  signguCd: 5,
  lDongRegnCd: 2,
  lDongSignguCd: 3,
};

const MAX_NUM_OF_ROWS = 1000;
const DEFAULT_PAGE_NO_CAP = 10;

export interface ValidatedRequest {
  operation: OperationName;
  numOfRows: number;
  pageNo: number;
  extraParams: Record<string, string>;
}

/**
 * Validates incoming client params against the operation's allowlisted schema.
 * `knownTotalCount` — when the caller (cache layer) already knows totalCount
 * for an identical prior request, it can be passed to compute the real
 * pageNo cap. Otherwise the constant fallback cap (10) is used.
 */
export function validateRequest(
  operation: string,
  rawParams: URLSearchParams,
  knownTotalCount?: number
): ValidatedRequest {
  for (const forbidden of FORBIDDEN_CLIENT_PARAMS) {
    if (rawParams.has(forbidden)) {
      throw new ValidationError(forbidden, `client must not supply "${forbidden}"; it is injected by the server`);
    }
  }

  if (!isKnownOp(operation)) {
    throw new ValidationError("operation", `unknown operation "${operation}"`);
  }
  const spec = OPERATIONS[operation];

  // numOfRows
  const numOfRowsRaw = rawParams.get("numOfRows") ?? "10";
  const numOfRows = parsePositiveInt(numOfRowsRaw, "numOfRows");
  if (numOfRows < 1 || numOfRows > MAX_NUM_OF_ROWS) {
    throw new ValidationError("numOfRows", `numOfRows must be between 1 and ${MAX_NUM_OF_ROWS}`);
  }

  // pageNo
  const pageNoRaw = rawParams.get("pageNo") ?? "1";
  const pageNo = parsePositiveInt(pageNoRaw, "pageNo");
  const cap =
    typeof knownTotalCount === "number" && knownTotalCount >= 0
      ? Math.max(1, Math.ceil(knownTotalCount / numOfRows))
      : DEFAULT_PAGE_NO_CAP;
  if (pageNo < 1 || pageNo > cap) {
    throw new ValidationError("pageNo", `pageNo must be between 1 and ${cap}`);
  }

  const extraParams: Record<string, string> = {};
  for (const paramSpec of spec.params) {
    const value = rawParams.get(paramSpec.name);
    if (value === null || value === "") {
      if (paramSpec.required) {
        throw new ValidationError(paramSpec.name, `"${paramSpec.name}" is required for operation "${operation}"`);
      }
      continue;
    }
    validateParamValue(paramSpec.name, value);
    extraParams[paramSpec.name] = value;
  }

  // Reject unknown extra params outright (not in spec, not numOfRows/pageNo/operation).
  const allowedKeys = new Set<string>(["operation", "numOfRows", "pageNo", ...spec.params.map((p) => p.name)]);
  for (const key of rawParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(key, `param "${key}" is not allowed for operation "${operation}"`);
    }
  }

  if (spec.crossFieldRule === "requireAreaAndSigngu") {
    if (!extraParams.areaCd || !extraParams.signguCd) {
      throw new ValidationError("areaCd/signguCd", `operation "${operation}" requires both areaCd and signguCd`);
    }
  }

  return { operation, numOfRows, pageNo, extraParams };
}

function isKnownOp(name: string): name is OperationName {
  return Object.prototype.hasOwnProperty.call(OPERATIONS, name);
}

function parsePositiveInt(raw: string, field: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(field, `"${field}" must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(field, `"${field}" must be a positive integer`);
  }
  return value;
}

function validateParamValue(name: ParamKind, value: string): void {
  if (name === "contentId") {
    if (!/^\d+$/.test(value)) {
      throw new ValidationError(name, `"${name}" must contain digits only`);
    }
    return;
  }
  if (name === "imageYN") {
    if (value !== "Y" && value !== "N") {
      throw new ValidationError(name, `"${name}" must be "Y" or "N"`);
    }
    return;
  }
  if (name === "baseYm") {
    if (!/^\d{6}$/.test(value)) {
      throw new ValidationError(name, `"${name}" must be YYYYMM (6 digits)`);
    }
    return;
  }
  if (name === "arrange") {
    if (!/^[A-Za-z]$/.test(value)) {
      throw new ValidationError(name, `"${name}" must be a single letter`);
    }
    return;
  }
  const requiredLen = DIGIT_LEN[name];
  if (requiredLen !== undefined) {
    // Preserve leading zeros: value stays a string throughout, only digit-count is checked.
    if (!new RegExp(`^\\d{${requiredLen}}$`).test(value)) {
      throw new ValidationError(name, `"${name}" must be exactly ${requiredLen} digits (leading zeros preserved)`);
    }
    return;
  }
}
