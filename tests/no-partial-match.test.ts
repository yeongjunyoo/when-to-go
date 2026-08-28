import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { variants } from "../worker/src/normalize";

// entity_precision_result.json (M0의 정본 근거)이 명시적으로 밝힌 결정:
// "4자 부분포함은 오매칭을 늘리므로 사용하지 않았다." 즉 4자 이상 부분
// 문자열 포함 매칭은 측정 단계에서 평가됐고 오매칭을 늘린다는 이유로
// 제품에서 배제됐다. B3는 이 규칙을 절대 이식하지 않는다 — 구조 검사와
// 행동 검사 둘 다로 고정한다.

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["web/src", "worker/src"];

// 부분포함 매칭의 시그니처: v1.py의 `any(v in p or p in v for v in bl for p in poi_long)`처럼
// 양방향 in/includes 비교, 또는 명시적인 부분포함 함수명.
const FORBIDDEN_SYMBOL_PATTERNS = [/\bpartialMatch\b/i, /\bsubstringMatch\b/i, /\bfuzzyMatch\b/i, /\bcontainsMatch\b/i, /\blen\s*\(\s*\w+\s*\)\s*>=\s*4/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("4자 부분포함 매칭 심볼이 소스에 존재하지 않는다 (구조 검사)", () => {
  it("금지된 부분포함 함수명/패턴이 web·worker 소스 어디에도 없다", () => {
    const violations: { file: string; pattern: string }[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const content = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_SYMBOL_PATTERNS) {
          if (pattern.test(content)) violations.push({ file: path.relative(ROOT, file), pattern: pattern.source });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("match.ts의 resolveAttraction에 양방향 부분문자열(v.includes(p) || p.includes(v)) 비교가 없다", () => {
    for (const rel of ["worker/src/match.ts", "web/src/match.ts"]) {
      const content = readFileSync(path.join(ROOT, rel), "utf8");
      // Detect the specific bidirectional-substring idiom, not every .includes() call
      // (addr1 mismatch checks legitimately use .includes() for exact address text).
      expect(content, `${rel} contains a bidirectional substring-match idiom`).not.toMatch(/includes\([^)]*\)\s*\|\|\s*[\w.]+\.includes\(/);
    }
  });
});

describe("4자 부분포함이 실제로 발동하지 않는다 (행동 검사)", () => {
  it("서로 다른 관광지명이 4자 이상 부분문자열을 공유해도 variants가 교차 매칭되지 않는다", () => {
    const a = variants("설악산국립공원전망대", "강원특별자치도", "속초시");
    const b = variants("설악산자연휴양림쉼터", "강원특별자치도", "속초시");
    const intersection = [...a].filter((v) => b.has(v));
    expect(intersection).toEqual([]);
  });

  it("정규화 결과는 정확히 일치하는 키만 담는다 — 부분 문자열 전부를 확장해 담지 않는다", () => {
    const result = variants("전주한옥마을", "전북특별자치도", "전주시");
    expect(result.has(normalizeKeyLocal("한옥마을"))).toBe(true);
    expect(result.has(normalizeKeyLocal("옥마을"))).toBe(false);
  });
});

function normalizeKeyLocal(s: string): string {
  return s.replace(/[\s\-_~,.'"·]/g, "").toLowerCase();
}
