// B-index: pure data-shape functions for the pre-built POI index layer.
//
// B-index is NOT a different matching algorithm — it is the SAME
// buildPoiIndex/resolveAttraction logic from match.ts, fed by a
// pre-serialized POI array instead of a live /api/poi fetch. The only
// thing that differs between B-live and B-index is the SOURCE of the POI
// array; everything downstream (variant matching, 4-path resolution) is
// byte-identical. This is what makes the "diff 0 between modes" contract
// achievable — see tests/index-goldset.test.ts.
//
// ★ Why this needs approval at all: an index built from real API responses
// and checked into git (or bundled into the deployed app) is DATA AT REST
// derived from upstream — a form of local/persistent storage this project
// otherwise runs without (worker/src/cache.ts is in-memory-only, no disk,
// no KV). Storing that data changes the compliance posture, so it is
// gated on an explicit local-storage approval rather than being on by
// default. See scripts/check-index-approval.mjs for the enforcement.
import type { PoiItem, PoiIndex } from "./match";
import { buildPoiIndex } from "./match";

/**
 * Marker key embedded ONLY in a real (approval-required) index payload,
 * set to literal `true` when serialized. Guards (scripts/check-index-
 * approval.mjs) search specifically for the compound JSON substring
 * `"__WTG_INDEX_REAL_DATA_MARKER__":true` — NOT the bare marker string —
 * because the bare string constant name inevitably appears in any built
 * JS bundle that merely *defines* this module (it's referenced as a
 * computed property key at runtime, which never literally serializes as
 * `"<marker>":true` unless the actual JSON payload contains it). Searching
 * for the bare string would false-positive on ordinary source code that
 * ships this file; searching for the compound key:true pattern only
 * matches an actual JSON-serialized real-data payload.
 */
export const INDEX_REAL_DATA_MARKER = "__WTG_INDEX_REAL_DATA_MARKER__";

export interface SignguIndexEntry {
  lDongRegnCd: string;
  lDongSignguCd: string;
  sidoName: string;
  signguName: string;
  pois: PoiItem[];
}

export interface PoiIndexData {
  generatedAt: string;
  entries: SignguIndexEntry[];
  /** Present (`true`) only when this payload was produced by the real generator from live API data. Absent/false for the empty placeholder. */
  [INDEX_REAL_DATA_MARKER]?: boolean;
}

/** Builds one signgu's index entry from a POI array (the generator's core packaging step). */
export function buildIndexEntry(
  lDongRegnCd: string,
  lDongSignguCd: string,
  sidoName: string,
  signguName: string,
  pois: PoiItem[]
): SignguIndexEntry {
  return { lDongRegnCd, lDongSignguCd, sidoName, signguName, pois };
}

/** Packages a list of entries into a full index payload. `markReal` must be true ONLY for genuine live-API-sourced data. */
export function buildIndexData(entries: SignguIndexEntry[], markReal: boolean): PoiIndexData {
  const data: PoiIndexData = { generatedAt: new Date().toISOString(), entries };
  if (markReal) data[INDEX_REAL_DATA_MARKER] = true;
  return data;
}

/**
 * Reconstructs a PoiIndex for one signgu from a loaded index payload, via
 * the EXACT SAME buildPoiIndex() used by the live path. Returns null when
 * the index doesn't cover the requested signgu — callers must fall back to
 * B-live for that signgu, never silently show an empty result.
 */
export function loadIndexFromData(data: PoiIndexData, lDongRegnCd: string, lDongSignguCd: string): { index: PoiIndex; entry: SignguIndexEntry } | null {
  const entry = data.entries.find((e) => e.lDongRegnCd === lDongRegnCd && e.lDongSignguCd === lDongSignguCd);
  if (!entry) return null;
  return { index: buildPoiIndex(entry.pois, entry.sidoName, entry.signguName), entry };
}
