// Fixed allowlist of the 6 supported upstream operations.
// Client-supplied operation names are matched EXACTLY against these keys —
// no prefix/suffix/fuzzy matching, so lookalike names are rejected.
// The upstream service path is fixed server-side; the client can never
// choose or influence the upstream path or host.

export type OperationName =
  | "ldongCode2"
  | "tatsCnctrRatedList"
  | "detailCommon2"
  | "detailImage2"
  | "areaBasedList1"
  | "areaBasedList2";

export type ParamKind = "numOfRows" | "pageNo" | "contentId" | "imageYN" | "areaCd" | "signguCd" | "baseYm" | "lDongRegnCd" | "lDongSignguCd" | "arrange";

export interface ParamSpec {
  name: ParamKind;
  required: boolean;
}

export interface OperationSpec {
  /** Fixed upstream service path, relative to UPSTREAM_BASE. */
  path: string;
  /** Allowed request params for this operation (beyond the injected/common ones). */
  params: ParamSpec[];
  /** Extra cross-field validation rule name, applied in validate.ts */
  crossFieldRule?: "requireAreaAndSigngu";
}

export const OPERATIONS: Record<OperationName, OperationSpec> = {
  ldongCode2: {
    path: "KorService2/ldongCode2",
    params: [],
  },
  tatsCnctrRatedList: {
    path: "TatsCnctrRateService/tatsCnctrRatedList",
    params: [
      { name: "areaCd", required: true },
      { name: "signguCd", required: true },
    ],
    crossFieldRule: "requireAreaAndSigngu",
  },
  detailCommon2: {
    path: "KorService2/detailCommon2",
    params: [{ name: "contentId", required: true }],
  },
  detailImage2: {
    path: "KorService2/detailImage2",
    params: [
      { name: "contentId", required: true },
      { name: "imageYN", required: true },
    ],
  },
  areaBasedList1: {
    path: "TarRlteTarService1/areaBasedList1",
    params: [
      { name: "areaCd", required: true },
      { name: "signguCd", required: true },
      { name: "baseYm", required: true },
    ],
  },
  areaBasedList2: {
    path: "KorService2/areaBasedList2",
    params: [
      { name: "lDongRegnCd", required: true },
      { name: "lDongSignguCd", required: true },
      { name: "arrange", required: false },
    ],
  },
};

export function isKnownOperation(name: string): name is OperationName {
  return Object.prototype.hasOwnProperty.call(OPERATIONS, name);
}

// Fixed upstream host — client can never override this.
export const UPSTREAM_HOST = "apis.data.go.kr";
