// Non-fuzzy candidate-name variant generation for B-live entity resolution
// (matching a concentration-data attraction name against areaBasedList2 POI
// titles). Mirrors the rules validated in the M0 measurement scripts
// (data/match_v2.py, data/entity_precision.py), with one critical fix found
// during the 2026-08-28 M0 run — see the region-name-only exclusion below.
//
// 6 rules:
//   1. strip bracket annotations   — "거문오름 [세계자연유산]"
//   2. split on slash / middle dot — "동쪽/서쪽" -> "동쪽", "서쪽"
//   3. strip parens + split comma-separated aliases inside them
//                                   — "거슨세미(세미오름, 샘오름)"
//   4. strip region-name prefix/suffix — sido, sido[:2], sigungu, sigungu w/o trailing 시/군/구
//   5. strip a trailing "폐역" facility-status suffix
//   6. whitespace/symbol normalization + lowercase (applied to every variant)
//
// ★ 7th rule (the M0 fix, not in the original scripts): a variant that
// normalizes to nothing but a bare region-name token itself (e.g. the "제주"
// alias split out of "관덕정(제주)") carries zero identifying information —
// it would match every POI whose title happens to contain that region's
// name. Region-name-only variants are excluded from the final candidate key
// set. This is what took the M0 multi-candidate count from 51 -> 14 and the
// unmatched rate from 21.96% -> 15.54%.
//
// Deliberately NOT ported: 4-character substring/containment matching.
// entity_precision_result.json's own scope note says it directly:
// "4자 부분포함은 오매칭을 늘리므로 사용하지 않았다" (evaluated and
// rejected because it increases false matches). It is not reintroduced
// here under any name — see tests/poi-match.test.ts and
// tests/no-partial-match.test.ts for the structural + behavioral guards.

export function normalizeKey(value: string | undefined | null): string {
  return (value ?? "").replace(/[\s\-_~,.'"·]/g, "").toLowerCase();
}

function rstripChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Produces the full set of normalized candidate keys for `name`, given the
 * sido/sigungu display names used for region-token stripping and exclusion.
 * Pure function — no I/O, no upstream calls.
 */
export function variants(name: string, sidoName: string, signguName: string): Set<string> {
  const raw = new Set<string>();
  const trimmedName = (name ?? "").trim();
  if (trimmedName) raw.add(trimmedName);
  raw.add(trimmedName.replace(/\[[^\]]*\]/g, "").trim());

  // Rule 2: slash / middle-dot split.
  for (const p of [...raw]) {
    for (const part of p.split(/[/·]/)) {
      const t = part.trim();
      if (t) raw.add(t);
    }
  }

  // Rule 3: paren removal + comma-separated alias split inside parens.
  for (const p of [...raw]) {
    raw.add(p.replace(/\([^)]*\)/g, "").trim());
    for (const match of p.matchAll(/\(([^)]*)\)/g)) {
      for (const alias of match[1].split(/[,，]/)) {
        const a = alias.trim();
        if (a.length > 1) raw.add(a);
      }
    }
  }

  // Rule 4: region-name prefix/suffix stripping.
  const signguStripped = rstripChars(signguName, "시군구");
  const tokens = new Set([signguName, signguStripped, sidoName, sidoName.slice(0, 2)].filter((t) => t && t.length >= 2));
  for (const p of [...raw]) {
    let q = p;
    for (const t of tokens) {
      q = q.replace(new RegExp(`^${escapeRegExp(t)}\\s*`), "");
      q = q.replace(new RegExp(`\\s*${escapeRegExp(t)}$`), "");
    }
    raw.add(q.trim());
  }

  // Rule 5: facility-status suffix.
  for (const p of [...raw]) {
    raw.add(p.replace(/\s*폐역$/, "").trim());
  }

  // Rule 6 + 7: normalize every surviving raw variant (>= 2 chars), and
  // drop any whose normalized form is nothing but a bare region token.
  const regionOnlyKeys = new Set([...tokens].map(normalizeKey));
  const result = new Set<string>();
  for (const p of raw) {
    if (p.length < 2) continue;
    const key = normalizeKey(p);
    if (!key) continue;
    if (regionOnlyKeys.has(key)) continue; // ★ M0 fix
    result.add(key);
  }
  return result;
}
