import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

// ★ COMP-B2-05 fix verification. Runs the actual guard script as a
// subprocess (not just source inspection) to prove:
//   1. it now statically scans worker/src (which never produces a build
//      artifact — the old guard silently passed here forever)
//   2. missing web/dist now fails by default instead of silently passing
//      (the exact "guaranteed green even pre-build" bug reported)

const ROOT = path.resolve(__dirname, "..");
const GUARD_SCRIPT = path.join(ROOT, "scripts/check-no-prod-fixtures.mjs");

function runGuard(args: string[] = []): { code: number; output: string } {
  try {
    const output = execSync(`node "${GUARD_SCRIPT}" ${args.join(" ")}`, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: `${e.stdout}\n${e.stderr}` };
  }
}

describe("check-no-prod-fixtures.mjs — worker/src\uc744 \uc815\uc801\uc73c\ub85c \uac10\uc9c0\ud558\uace0, \ubc88\ub4e4 \ubd80\uc7ac \uc2dc \uae30\ubcf8 \uc2e4\ud328\ud55c\ub2e4", () => {
  it("\uc815\uc0c1 \uc0c1\ud0dc\uc5d0\uc11c\ub294 \ud1b5\uacfc\ud55c\ub2e4", () => {
    const result = runGuard();
    expect(result.code).toBe(0);
  });

  describe("★ worker/src\uc5d0 fixtures import\ub97c \uc2ec\uc73c\uba74 \uc2e4\uc81c\ub85c \uc2e4\ud328\ud55c\ub2e4", () => {
    const plantedFile = path.join(ROOT, "worker/src/__test_planted_fixture_import.ts");

    afterEach(() => {
      if (existsSync(plantedFile)) rmSync(plantedFile);
    });

    it("\ube4c\ub4dc \uc0b0\ucd9c\ubb3c\uc774 \uc5c6\uc5b4\ub3c4 (\uad6c \uc2a4\ucf00\uc77c\ub9c1\uc774\uba74 \uc5b4\ub290 \ube4c\ub4dc\ub3c4 \uac70\uce58\uc9c0 \uc54a\uc558\uc744 \uacbd\ub85c\ub3c4) \uc815\uc801 import \uc2a4\uce94\uc73c\ub85c \uac10\uc9c0\ub41c\ub2e4", () => {
      writeFileSync(plantedFile, 'import x from "../tests/fixtures/evil.json"; export const y = x;', "utf8");
      const result = runGuard(["--allow-missing-bundle"]);
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/worker-src-import/);
    });
  });

  describe("★ web/dist가 없을 때 기본 동작을 실제로 재현한다 (예전 버그: 항상 통과)", () => {
    const distDir = path.join(ROOT, "web/dist");
    const backupDir = path.join(ROOT, "web/__dist_backup_for_test");

    afterEach(() => {
      // 복원: 백업이 있으면 dist로 되돌린다.
      if (existsSync(backupDir)) {
        if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
        require("node:fs").renameSync(backupDir, distDir);
      }
    });

    it("dist를 임시로 치우면 --allow-missing-bundle 없이는 실패하고, 붙이면 통과한다", () => {
      if (!existsSync(distDir)) return; // 이미 없으면(빌드 전 시나리오) 이 테스트는 생략
      require("node:fs").renameSync(distDir, backupDir);

      const withoutFlag = runGuard();
      expect(withoutFlag.code).toBe(1);
      expect(withoutFlag.output).toMatch(/web\/dist not found/);

      const withFlag = runGuard(["--allow-missing-bundle"]);
      expect(withFlag.code).toBe(0);
    });
  });
});
