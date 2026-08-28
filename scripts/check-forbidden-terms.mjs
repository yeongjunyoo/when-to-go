#!/usr/bin/env node
// CI guard: forbidden org-name terms must never appear in rendered UI,
// public URLs, or the package name.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FORBIDDEN_PATTERNS = [/한국관광공사/g, /\bKTO\b/g, /Korea Tourism/gi];

const TARGET_GLOBS = ["web/src", "web/index.html", "web/dist", "README.md"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const st = statSync(dir);
  if (st.isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    walk(path.join(dir, entry), out);
  }
  return out;
}

let violations = [];

for (const target of TARGET_GLOBS) {
  const full = path.join(root, target);
  for (const file of walk(full)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        violations.push({ file: path.relative(root, file), pattern: pattern.source });
      }
    }
  }
}

// package.json name field check
const pkgPath = path.join(root, "package.json");
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(pkg.name ?? "")) {
      violations.push({ file: "package.json#name", pattern: pattern.source });
    }
  }
}

if (violations.length > 0) {
  console.error("금지어 발견:");
  for (const v of violations) {
    console.error(`  - ${v.file}: matched /${v.pattern}/`);
  }
  process.exit(1);
}

console.log("check:terms — 0 violations found.");
process.exit(0);
