import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// B4 지도는 빌드 플래그 + route-level code splitting 뒤에 있어야 한다
// (Kill Table R14: 09-13까지 G4 미달성 또는 타일 약관 미확인이면 지도 폐기,
// 그 기본 동작이 플래그 off 배포여야 하며 수작업 코드 제거가 아니어야 한다).
// 실제 번들 스플리팅 자체는 web/dist 산출물 확인으로 증명됐다(빌드 로그의
// 별도 MapView-*.js/.css 청크, index.html이 그 청크를 참조하지 않음).
// 여기서는 그 스플리팅을 가능하게 하는 소스 계약(React.lazy + 조건부 렌더)을
// 정적으로 고정한다.

const ROOT = path.resolve(__dirname, "..");

describe("B4 지도 빌드 플래그 계약", () => {
  it("MAP_ENABLED는 VITE_ENABLE_MAP이 정확히 'true'일 때만 켜진다 (기본값 off)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/featureFlags.ts"), "utf8");
    expect(content).toMatch(/VITE_ENABLE_MAP\s*===\s*"true"/);
  });

  it("App.tsx는 MapView를 정적 import가 아니라 React.lazy()로 로드한다", () => {
    const content = readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
    expect(content).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/MapView["']\)\)/);
    // 정적 import 형태("import MapView from './MapView'")가 없어야 한다.
    expect(content).not.toMatch(/^import\s+MapView\s+from/m);
  });

  it("App.tsx의 지도 렌더 분기는 MAP_ENABLED 플래그로 감싸져 있다", () => {
    const content = readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
    expect(content).toMatch(/MAP_ENABLED\s*&&/);
  });

  it("MapView는 Suspense 경계 안에서만 렌더된다 (지연 로딩 중 깨지지 않도록)", () => {
    const content = readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
    expect(content).toMatch(/<Suspense[\s\S]*<MapView/);
  });
});
