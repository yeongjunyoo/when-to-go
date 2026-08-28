import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// B6 fix regression: main.tsx never imported `virtual:pwa-register`, so
// even though vite.config.ts set registerType: "autoUpdate", an
// already-open tab kept serving the OLD JS bundle after a deploy (per
// vite-plugin-pwa's own docs: without importing a virtual module, "there
// is no way to interact with the application UI, and so any client
// tab/window will not be reloaded"). Reproduced firsthand after the B4
// deploy. This test pins the fix at the source level.

const ROOT = path.resolve(__dirname, "..");

describe("서비스워커 갱신 전략 — virtual:pwa-register 실제 사용", () => {
  it("web/src/pwaUpdate.ts가 virtual:pwa-register의 registerSW를 import한다", () => {
    const content = readFileSync(path.join(ROOT, "web/src/pwaUpdate.ts"), "utf8");
    expect(content).toMatch(/from\s+["']virtual:pwa-register["']/);
    expect(content).toMatch(/registerSW\(/);
  });

  it("main.tsx가 initPwaUpdate()를 실제로 호출한다 (모듈만 만들고 안 부르는 결함 방지)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/main.tsx"), "utf8");
    expect(content).toMatch(/import\s*\{\s*initPwaUpdate\s*\}\s*from\s*["']\.\/pwaUpdate["']/);
    expect(content).toMatch(/initPwaUpdate\(\)/);
  });

  it("immediate:true로 설정되어 열려 있는 탭도 자동 갱신된다 (폼 미보유 서비스라 데이터 손실 위험 낮음)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/pwaUpdate.ts"), "utf8");
    expect(content).toMatch(/immediate:\s*true/);
  });

  it("주기적 업데이트 폴링이 설정되어 있다 (탐색 없이 열려 있는 탭도 갱신 감지)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/pwaUpdate.ts"), "utf8");
    expect(content).toMatch(/setInterval/);
    expect(content).toMatch(/registration\.update\(\)/);
  });

  it("SW 스크립트 갱신 확인 시 캐시를 우회한다 (no-store) — 프록시/CDN이 옛 sw.js를 캐시해도 감지된다", () => {
    const content = readFileSync(path.join(ROOT, "web/src/pwaUpdate.ts"), "utf8");
    expect(content).toMatch(/cache:\s*["']no-store["']/);
  });

  it("vite-env.d.ts가 vite-plugin-pwa/client 타입을 참조한다 (virtual 모듈 타입체크 통과 필요조건)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/vite-env.d.ts"), "utf8");
    expect(content).toMatch(/reference types="vite-plugin-pwa\/client"/);
  });
});

describe("PWA 캐시 범위 — 정적 자산만, API 응답 캐시 없음", () => {
  it("vite.config.ts가 API 라우트에 대한 런타임 캐싱 규칙을 설정하지 않는다", () => {
    const content = readFileSync(path.join(ROOT, "web/vite.config.ts"), "utf8");
    // runtimeCaching 옵션이 있으면 API 응답을 SW가 캐시할 수 있으므로, 이 프로젝트는
    // 그 옵션 자체를 쓰지 않는다(generateSW 기본 동작 = 빌드 산출물만 precache).
    expect(content).not.toMatch(/runtimeCaching/);
  });
});
