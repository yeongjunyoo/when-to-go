#!/usr/bin/env node
// B-index double guard (hard rule 3): a real-data POI index must NEVER be
// generated, committed, or deployed without local-storage approval.
//
// ★ Guard 1: build bundle scan — does the compiled web/dist output contain
//   the real-data marker (i.e. did the app actually ship real index data)?
// ★ Guard 2: git-tracked-file scan — is the generated index file tracked
//   by git with real data in it? This exists because the repo is public
//   (contest requirement), so a committed-but-undeployed real index would
//   still leak: architect flagged (ARCH-B2-03) that a bundle-only guard
//   can be bypassed by committing the file without ever building/deploying
//   it — the data becomes public via the repo itself.
//
// Both guards search for the COMPOUND pattern `"<marker>":true` (the JSON
// key:value pair that only appears in a real generator payload), not the
// bare marker string constant (which legitimately appears in source code
// that merely defines/references the marker name).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const REAL_DATA_KEY_PATTERN = /"__WTG_INDEX_REAL_DATA_MARKER__"\s*:\s*true/;

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

function scanBundleForRealData() {
  const violations = [];
  const bundleDir = path.join(ROOT, "web/dist");
  if (!existsSync(bundleDir)) return { violations, scanned: false };
  for (const file of walk(bundleDir)) {
    if (!/\.(js|mjs|cjs|json|html)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    if (REAL_DATA_KEY_PATTERN.test(content)) {
      violations.push(path.relative(ROOT, file));
    }
  }
  return { violations, scanned: true };
}

function scanGitTrackedForRealData() {
  const violations = [];
  let trackedFiles;
  try {
    trackedFiles = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    // Not a git repo / git unavailable — nothing to scan, but this is not
    // a pass condition by itself; report as unscanned so callers can decide.
    return { violations, scanned: false };
  }
  for (const relFile of trackedFiles) {
    if (!relFile.endsWith(".json") && !relFile.endsWith(".js") && !relFile.endsWith(".mjs")) continue;
    const full = path.join(ROOT, relFile);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, "utf8");
    if (REAL_DATA_KEY_PATTERN.test(content)) {
      violations.push(relFile);
    }
  }
  return { violations, scanned: true };
}

function currentApprovalFlag() {
  // The build-time flag that would have made B-index reachable at runtime.
  // Approval status itself is a human/organizational fact this script
  // cannot verify — it only checks whether real DATA exists, which must be
  // false regardless of the flag's value unless approval is genuinely on.
  return process.env.VITE_LOCAL_STORAGE_APPROVED === "true";
}

function main() {
  const bundleResult = scanBundleForRealData();
  const gitResult = scanGitTrackedForRealData();

  const allViolations = [...bundleResult.violations.map((f) => ({ guard: "bundle", file: f })), ...gitResult.violations.map((f) => ({ guard: "git-tracked", file: f }))];

  if (allViolations.length > 0) {
    console.error("B-index real-data marker found without confirmed approval context:");
    for (const v of allViolations) {
      console.error(`  [${v.guard}] ${v.file}`);
    }
    console.error(
      `\nA real POI index payload was detected. This is only legitimate when local-storage\n` +
        `approval has been explicitly granted. Approval flag VITE_LOCAL_STORAGE_APPROVED=${currentApprovalFlag()}.\n` +
        `If approval was NOT granted, remove the real-data index (reset web/src/generated/poi-index.generated.json\n` +
        `to the empty placeholder) and never commit/deploy real index output pre-approval.`
    );
    process.exit(1);
  }

  console.log(
    `check:index-approval — 0 violations. bundle scanned=${bundleResult.scanned}, git-tracked scanned=${gitResult.scanned}, approval flag=${currentApprovalFlag()}.`
  );
  process.exit(0);
}

main();
