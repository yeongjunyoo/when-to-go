#!/usr/bin/env node
// CI guard: 디자인 값은 src/design/tokens.css 한 곳에서만 나온다.
//
// 이 검사가 있는 이유 — 에이전트가 UI 를 고칠 때 가장 흔하게 하는 일이
// 컴포넌트에 색을 직접 박는 것이다. 한 번 박히면 다크모드에서 깨지고,
// 다음 사람이 그걸 보고 따라 박아 값이 갈라진다. 규칙을 문서에만 적어 두면
// 안 지켜지므로 여기서 깬다.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const TOKENS_FILE = "web/src/design/tokens.css";
const SCAN_DIRS = ["web/src", "web/index.html"];

// tokens.css 자신과, 색 문자열을 런타임에 읽어 주는 헬퍼는 예외다.
const EXEMPT = new Set([TOKENS_FILE, "web/src/design/token.ts"]);

const RULES = [
  {
    id: "raw-color",
    // #abc / #aabbcc / #aabbccdd, rgb(), rgba(), hsl(), hsla()
    pattern: /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|\b(?:rgba?|hsla?)\s*\(/g,
    message: "색을 직접 박았다. tokens.css 에 토큰을 만들고 클래스나 var() 로 써라",
  },
  {
    id: "tailwind-default-palette",
    // bg-gray-50, text-blue-800, border-amber-300 …
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/g,
    message:
      "Tailwind 기본 팔레트 클래스다. 시맨틱 클래스를 써라 (bg-surface, text-muted, border-default, bg-info …)",
  },
  {
    id: "arbitrary-color",
    // bg-[#fff], text-[rgb(...)] — 팔레트를 덮어써도 임의값으로는 빠져나갈 수 있다
    pattern: /\b(?:bg|text|border|ring|fill|stroke|shadow)-\[[^\]]*(?:#|rgb|hsl)[^\]]*\]/g,
    message: "임의값으로 색을 넣었다. tokens.css 에 토큰을 만들어라",
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (statSync(dir).isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    walk(path.join(dir, entry), out);
  }
  return out;
}

const violations = [];

for (const target of SCAN_DIRS) {
  for (const file of walk(path.join(root, target))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (EXEMPT.has(rel)) continue;
    if (!/\.(tsx?|css|html)$/.test(rel)) continue;

    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (const rule of RULES) {
      lines.forEach((line, i) => {
        // 주석 줄은 예시를 적어 둘 수 있으니 넘어간다
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        rule.pattern.lastIndex = 0;
        const m = rule.pattern.exec(line);
        if (m) {
          violations.push({ file: rel, line: i + 1, rule: rule.id, hit: m[0], message: rule.message });
        }
      });
    }
  }
}

// 참조된 var(--…) 가 실제로 정의돼 있는지. 없는 토큰은 조용히 투명해진다.
const tokensPath = path.join(root, TOKENS_FILE);
if (!existsSync(tokensPath)) {
  console.error(`토큰 정본이 없다: ${TOKENS_FILE}`);
  process.exit(1);
}
const tokensCss = readFileSync(tokensPath, "utf8");
const defined = new Set([...tokensCss.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));

for (const target of SCAN_DIRS) {
  for (const file of walk(path.join(root, target))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === TOKENS_FILE) continue;
    if (!/\.(tsx?|css|html)$/.test(rel)) continue;
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/var\(\s*--([a-z0-9-]+)/g)) {
      if (!defined.has(m[1])) {
        violations.push({
          file: rel,
          line: content.slice(0, m.index).split("\n").length,
          rule: "unknown-token",
          hit: `--${m[1]}`,
          message: `tokens.css 에 없는 토큰이다. 정의를 추가하거나 오타를 고쳐라`,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`디자인 토큰 위반 ${violations.length}건 — 값은 ${TOKENS_FILE} 에서만 나온다:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.hit}`);
    console.error(`      → ${v.message}`);
  }
  process.exit(1);
}

console.log("디자인 토큰 검사 통과 — 색·토큰 하드코딩 0건");
