// Single interface consumer code (App.tsx, MapView.tsx) calls to get a POI
// index for a signgu. Consumer code NEVER checks whether B-index exists —
// it always calls getPoiIndexFor(); this module decides internally whether
// to serve from the pre-built index (if approved AND the index covers this
// signgu) or fall back to the live /api/poi fetch. Same interface either
// way, so there is nothing for a caller to branch on.
import { fetchPoiIndex } from "./proxyClient";
import { buildPoiIndex, PoiIndex } from "./match";
import { LOCAL_STORAGE_APPROVED } from "./localStorageApproval";
import { loadIndexFromData, PoiIndexData } from "./indexBuilder";

export type PoiSourceOutcome =
  | { ok: true; index: PoiIndex; source: "index" | "live" }
  | { ok: false; failureReason?: string };

/**
 * Loads a pre-parsed index payload, if approval is on and one is bundled.
 * Returns null with zero side effects when approval is off, or when no
 * index module has been bundled (the common/default case pre-approval) —
 * this indirection exists so importing this module never fails just
 * because `../../data/poi-index.generated.json` doesn't exist yet.
 */
async function tryLoadBundledIndex(): Promise<PoiIndexData | null> {
  if (!LOCAL_STORAGE_APPROVED) return null;
  // web/src/generated/poi-index.generated.json ALWAYS exists in the repo as
  // an empty placeholder ({ entries: [] }, no real-data marker) so this
  // static import never breaks the build for anyone — pre-approval, it just
  // resolves to an index with zero coverage, which loadIndexFromData()
  // below correctly reports as "doesn't cover this signgu" and the caller
  // falls back to B-live. Only scripts/generate-poi-index.mjs, run
  // manually post-approval, ever overwrites it with real entries + the
  // marker.
  const mod = (await import("./generated/poi-index.generated.json")) as { default: PoiIndexData };
  return mod.default;
}

/**
 * Gets a POI index for one signgu. Tries B-index first (only when
 * approved), falls back to B-live (/api/poi) otherwise or when the index
 * doesn't cover this signgu. The returned `index` has the exact same
 * shape either way — resolveAttraction()/buildPoiIndex() callers cannot
 * tell which source produced it.
 */
export async function getPoiIndexFor(lDongRegnCd: string, lDongSignguCd: string, sidoName: string, signguName: string): Promise<PoiSourceOutcome> {
  const bundled = await tryLoadBundledIndex();
  if (bundled) {
    const loaded = loadIndexFromData(bundled, lDongRegnCd, lDongSignguCd);
    if (loaded) return { ok: true, index: loaded.index, source: "index" };
    // Index exists but doesn't cover this signgu — fall through to live.
  }

  const liveOutcome = await fetchPoiIndex(lDongRegnCd, lDongSignguCd);
  if (!liveOutcome.ok) return { ok: false, failureReason: liveOutcome.failureReason };
  return { ok: true, index: buildPoiIndex(liveOutcome.items, sidoName, signguName), source: "live" };
}
