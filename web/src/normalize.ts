// Mirror of worker/src/normalize.ts (no shared package in this scaffold).
// Kept byte-for-byte equivalent in behavior; tests/mirror-sync-poi.test.ts
// pins the two together so drift (like the Sejong drift in B1) is caught
// mechanically instead of surfacing only in the deployed browser.
//
// See worker/src/normalize.ts for the full rule rationale, including the
// M0 region-name-only exclusion fix and the deliberate omission of
// 4-character substring matching (evaluated and rejected upstream —
// entity_precision_result.json: "4자 부분포함은 오매칭을 늘리므로 사용하지 않았다").

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

export function variants(name: string, sidoName: string, signguName: string): Set<string> {
  const raw = new Set<string>();
  const trimmedName = (name ?? "").trim();
  if (trimmedName) raw.add(trimmedName);
  raw.add(trimmedName.replace(/\[[^\]]*\]/g, "").trim());

  for (const p of [...raw]) {
    for (const part of p.split(/[/·]/)) {
      const t = part.trim();
      if (t) raw.add(t);
    }
  }

  for (const p of [...raw]) {
    raw.add(p.replace(/\([^)]*\)/g, "").trim());
    for (const match of p.matchAll(/\(([^)]*)\)/g)) {
      for (const alias of match[1].split(/[,，]/)) {
        const a = alias.trim();
        if (a.length > 1) raw.add(a);
      }
    }
  }

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

  for (const p of [...raw]) {
    raw.add(p.replace(/\s*폐역$/, "").trim());
  }

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
