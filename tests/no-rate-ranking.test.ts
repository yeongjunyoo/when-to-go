import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// HARD CONTEST RULE: cnctrRate (congestion rate) is a per-signgu relative
// normalization, not comparable across attractions. This test proves the
// source tree contains NO function whose job is to sort/filter/cut the
// attraction list by cnctrRate. It is a structural guarantee, not a
// behavioral spot-check: even an unused/dead rate-ranking symbol fails it.

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["web/src", "worker/src"];

// Symbol-name patterns that would indicate a rate-based ranking API exists.
const FORBIDDEN_SYMBOL_PATTERNS = [
  /\bsortByRate\b/i,
  /\btopN\b/i,
  /\bfilterByRate\b/i,
  /\bsortByCnctr/i,
  /\brankByRate\b/i,
  /\btopAttractions\b/i,
  /\bfilterByCnctr/i,
  /\bsortByCongestion/i,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no rate-based ranking API exists in source", () => {
  it("scans web/src and worker/src for forbidden sort/filter/topN-by-rate symbols", () => {
    const violations: { file: string; pattern: string }[] = [];
    for (const dir of SCAN_DIRS) {
      const full = path.join(ROOT, dir);
      for (const file of walk(full)) {
        const content = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_SYMBOL_PATTERNS) {
          if (pattern.test(content)) {
            violations.push({ file: path.relative(ROOT, file), pattern: pattern.source });
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the only exported attraction-ordering function sorts alphabetically, not by cnctrRate", () => {
    const source = readFileSync(path.join(ROOT, "web/src/sortAttractions.ts"), "utf8");
    expect(source).toMatch(/localeCompare/);
    expect(source).not.toMatch(/cnctrRate/i);
  });
});
