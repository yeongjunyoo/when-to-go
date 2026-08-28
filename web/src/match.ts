// Mirror of worker/src/match.ts. Matching runs client-side because the
// frontend already holds both inputs (the collected attraction rows from
// /api/collect and the POI candidate index from /api/poi) — no extra
// round-trip needed, and it keeps the rejection-path logic in one place
// per side (worker mirror kept for potential future server-side use / test
// parity, not currently called by any route).
import { variants } from "./normalize";

export interface PoiItem {
  contentid: string;
  title: string;
  addr1: string;
  mapx: string;
  mapy: string;
}

export type MatchOutcome =
  | { kind: "zero_candidates" }
  | { kind: "multiple_candidates"; candidates: PoiItem[] }
  | { kind: "address_mismatch"; candidates: PoiItem[] }
  | { kind: "single_match"; poi: PoiItem };

export interface PoiIndex {
  byVariant: Map<string, PoiItem[]>;
}

export function buildPoiIndex(poiItems: PoiItem[], sidoName: string, signguName: string): PoiIndex {
  const byVariant = new Map<string, PoiItem[]>();
  for (const poi of poiItems) {
    for (const v of variants(poi.title, sidoName, signguName)) {
      const bucket = byVariant.get(v);
      if (bucket) bucket.push(poi);
      else byVariant.set(v, [poi]);
    }
  }
  return { byVariant };
}

function dedupeCandidates(candidates: PoiItem[]): PoiItem[] {
  const seen = new Set<string>();
  const out: PoiItem[] = [];
  for (const poi of candidates) {
    const identity = `${poi.contentid}::${poi.title}::${poi.addr1}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      out.push(poi);
    }
  }
  return out;
}

export function resolveAttraction(attractionName: string, index: PoiIndex, sidoName: string, signguName: string): MatchOutcome {
  const seenIdentities = new Set<string>();
  const merged: PoiItem[] = [];
  for (const v of variants(attractionName, sidoName, signguName)) {
    const bucket = index.byVariant.get(v);
    if (!bucket) continue;
    for (const poi of bucket) {
      const identity = `${poi.contentid}::${poi.title}::${poi.addr1}`;
      if (!seenIdentities.has(identity)) {
        seenIdentities.add(identity);
        merged.push(poi);
      }
    }
  }
  const candidates = dedupeCandidates(merged);

  if (candidates.length === 0) return { kind: "zero_candidates" };
  if (candidates.length > 1) return { kind: "multiple_candidates", candidates };

  const poi = candidates[0];
  if (!(poi.addr1 || "").includes(signguName)) {
    return { kind: "address_mismatch", candidates };
  }

  return { kind: "single_match", poi };
}
