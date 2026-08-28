import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

// ★ G5 게이트: "2중 가드 감지력 직접 확인" — 실행 파일 자체를 서브프로세스로
// 돌려서 진짜로 실패하는지 검증한다(단순히 소스 코드를 읽고 "그럴듯해 보인다"고
// 넘기지 않는다). 두 가드(빌드 번들 / git 추적 파일)를 각각 독립적으로 발동시켜
// 확인한 뒤, 심어둔 위반물을 원상복구한다.

const ROOT = path.resolve(__dirname, "..");
const GUARD_SCRIPT = path.join(ROOT, "scripts/check-index-approval.mjs");
const REAL_MARKER_PAYLOAD = JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", entries: [], __WTG_INDEX_REAL_DATA_MARKER__: true });

function runGuard(): { code: number; output: string } {
  try {
    const output = execSync(`node "${GUARD_SCRIPT}"`, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: `${e.stdout}\n${e.stderr}` };
  }
}

describe("check-index-approval.mjs — 실제 실행으로 감지력 확인", () => {
  it("정상 상태(플레이스홀더만 있음)에서는 통과한다", () => {
    const result = runGuard();
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/0 violations/);
  });

  describe("가드 1: 빌드 번들에 실데이터 마커를 심으면 실패한다", () => {
    const bundleDir = path.join(ROOT, "web/dist/assets");
    const plantedFile = path.join(bundleDir, "__test_planted_index.js");

    afterEach(() => {
      if (existsSync(plantedFile)) rmSync(plantedFile);
    });

    it("★ 실제로 dist에 마커를 심으면 가드가 즉시 실패한다", () => {
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(plantedFile, `const idx=${REAL_MARKER_PAYLOAD};`, "utf8");

      const result = runGuard();
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/bundle/);
      expect(result.output).toMatch(/__test_planted_index\.js/);
    });
  });

  describe("가드 2: git에 실데이터가 커밋되면 실패한다 (repo 공개 전제 — 배포와 별개 경로)", () => {
    const plantedRelPath = "web/src/generated/__test_planted_committed_index.json";
    const plantedFile = path.join(ROOT, plantedRelPath);

    afterEach(() => {
      try {
        execSync(`git rm --cached --force "${plantedRelPath}"`, { cwd: ROOT, stdio: "pipe" });
      } catch {
        // may not be tracked if the test failed before staging; ignore
      }
      if (existsSync(plantedFile)) rmSync(plantedFile);
    });

    it("★ dist 없이도, git add만으로 (배포 여부와 무관하게) 가드가 실패한다", () => {
      // dist가 없는 상태에서도(가드 1이 관여하지 않아도) git 추적만으로 걸려야
      // repo 공개 우회를 실제로 막는다는 것이 증명된다.
      writeFileSync(plantedFile, REAL_MARKER_PAYLOAD, "utf8");
      execSync(`git add "${plantedRelPath}"`, { cwd: ROOT, stdio: "pipe" });

      const result = runGuard();
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/git-tracked/);
      expect(result.output).toMatch(/__test_planted_committed_index\.json/);
    });
  });

  it("실데이터 마커가 아닌 평범한 JSON(빈 entries)은 통과시킨다 (오탐 없음)", () => {
    // 플레이스홀더 자체가 이미 이 케이스를 매 실행마다 검증하지만, 명시적으로도 확인한다.
    const result = runGuard();
    expect(result.code).toBe(0);
  });
});
