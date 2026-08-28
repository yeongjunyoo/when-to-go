#!/usr/bin/env node
// Production fixture guard: fails if any test fixture module or its marker
// string ends up reachable from production code.
//
// ★ COMP-B2-05 fix: worker deployment never produces a `worker/dist`
// directory — `worker/package.json`'s build script is `tsc --noEmit`
// (typecheck only), and the actual deploy artifact is built by
// `wrangler deploy` bundling `worker/src/index.ts` directly at deploy
// time. That means the worker's real shipped output NEVER went through
// this guard before: the old version only scanned `web/dist` +
// `worker/dist`, the latter of which never exists, so it always reported
// "nothing to scan" + exit 0 whenever run pre-build — a guaranteed green
// even in the presence of an actual fixture import.
//
// Fix: statically scan `worker/src/**/*.ts` source for any import that
// resolves into `tests/fixtures/` or a `fixtures/` directory — this
// doesn't depend on a build artifact existing at all, so it can never be
// silently skipped. The web-side dist bundle scan is kept (web really
// does produce `web/dist`), but "no bundle found yet" now exits non-zero
// by default instead of silently passing, unless the caller explicitly
// opts into pre-build mode with --allow-missing-bundle (used by fresh
// checkouts where `npm run build` hasn't run yet).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FIXTURE_MARKER = "__WTG_TEST_FIXTURE_MARKER__";
const BUNDLE_DIRS = ["web/dist"];
const WORKER_SRC_DIR = "worker/src";
const ALLOW_MISSING_BUNDLE = process.argv.includes("--allow-missing-bundle");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const st = statSync(dir);
  if (st.isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of readdirSync(dir)) {
    walk(path.join(dir, entry), out);
  }
  return out;
}

let violations = [];

// --- Guard A: web production bundle scan (marker string) ---
let scannedAnyBundle = false;
for (const bundleDir of BUNDLE_DIRS) {
  const full = path.join(root, bundleDir);
  if (!existsSync(full)) continue;
  scannedAnyBundle = true;
  for (const file of walk(full)) {
    if (!/\.(js|mjs|cjs|css|html)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    if (content.includes(FIXTURE_MARKER)) {
      violations.push({ kind: "bundle", file: path.relative(root, file) });
    }
  }
}

// --- Guard B: worker/src static import scan (no build artifact needed) ---
const FIXTURE_IMPORT_PATTERN = /from\s+["'][^"']*\/?(?:tests\/)?fixtures\/[^"']*["']/;
const workerSrcFull = path.join(root, WORKER_SRC_DIR);
let scannedWorkerSrc = false;
if (existsSync(workerSrcFull)) {
  scannedWorkerSrc = true;
  for (const file of walk(workerSrcFull)) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    if (FIXTURE_IMPORT_PATTERN.test(content) || content.includes(FIXTURE_MARKER)) {
      violations.push({ kind: "worker-src-import", file: path.relative(root, file) });
    }
  }
}

if (violations.length > 0) {
  console.error("Production code references test fixture content:");
  for (const v of violations) console.error(`  [${v.kind}] ${v.file}`);
  process.exit(1);
}

if (!scannedWorkerSrc) {
  console.error("check:fixtures — worker/src not found; cannot verify worker production code is fixture-free.");
  process.exit(1);
}

if (!scannedAnyBundle && !ALLOW_MISSING_BUNDLE) {
  console.error(
    "check:fixtures — web/dist not found. Run `npm run build` first, or pass --allow-missing-bundle\n" +
      "for an explicit pre-build check (worker/src static scan still ran and passed)."
  );
  process.exit(1);
}

console.log(
  `check:fixtures — 0 violations. worker/src statically scanned (${scannedWorkerSrc}), web bundle scanned (${scannedAnyBundle}).`
);
process.exit(0);
