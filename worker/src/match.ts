// B-live entity resolution: matches a concentration-data attraction name
// against the POI candidate index for its sigungu, using the non-fuzzy
// variant rules in normalize.ts. Produces one of 4 outcomes — never a
// guessed mapping.
import { variants } from "./normalize";
import { PoiItem } from "./poi";

export type MatchOutcome =
  | { kind: "zero_candidates" }
  | { kind: "multiple_candidates"; candidates: PoiItem[] }
  | { kind: "address_mismatch"; candidates: PoiItem[] }
  | { kind: "single_match"; poi: PoiItem };

export interface PoiIndex {
  byVariant: Map<string, PoiItem[]>;
}

/** Builds a variant -> POI[] index once per POI set, reused across many attraction-name lookups. */
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

/**
 * Resolves `attractionName` against the POI index for the given sigungu.
 * Three rejection paths, one success path — matches the M0 measurement
 * design exactly:
 *   - zero candidates: unlinked, no detail shown
 *   - multiple candidates: unlinked, NEVER guess which one is correct
 *   - address mismatch: the single (or all) matched POI's addr1 doesn't
 *     contain the target sigungu name — flagged, no detail shown
 *   - single match: detail shown, but labeled as an inferred link
 *     (precision is unmeasured in production, only spot-checked in M0)
 */
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
  // Address-mismatch check: addr1 must contain the target sigungu's display name.
  // A blank addr1 counts as a mismatch (per M0's measurement definition).
  if (!(poi.addr1 || "").includes(signguName)) {
    return { kind: "address_mismatch", candidates };
  }

  return { kind: "single_match", poi };
}
