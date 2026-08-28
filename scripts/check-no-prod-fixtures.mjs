#!/usr/bin/env node
// Production fixture guard: fails the build if any test fixture module or
// its marker string ends up inside a production bundle (web/dist or
// worker build output). Fixtures are for tests only.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Every fixture file in tests/fixtures embeds this exact marker string.
const FIXTURE_MARKER = "__WTG_TEST_FIXTURE_MARKER__";

const BUNDLE_DIRS = ["web/dist", "worker/dist"];

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
let scannedAnyBundle = false;

for (const bundleDir of BUNDLE_DIRS) {
  const full = path.join(root, bundleDir);
  if (!existsSync(full)) continue;
  scannedAnyBundle = true;
  for (const file of walk(full)) {
    if (!/\.(js|mjs|cjs|css|html)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    if (content.includes(FIXTURE_MARKER)) {
      violations.push(path.relative(root, file));
    }
  }
}

if (violations.length > 0) {
  console.error("Production bundle contains test fixture content:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

if (!scannedAnyBundle) {
  console.log("check:fixtures — no build output found yet (run after `npm run build`); nothing to scan.");
  process.exit(0);
}

console.log("check:fixtures — 0 fixture leaks found in production bundles.");
process.exit(0);
