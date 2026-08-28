import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Verifies the actual build output (when present) proves route-level code
// splitting: MapView/Leaflet code lives in a separate chunk that
// index.html never references directly, and the eagerly-loaded main
// bundle contains no Leaflet source. This test is best-effort — it only
// runs its assertions when `web/dist` exists (i.e. after `npm run build`),
// mirroring scripts/check-no-prod-fixtures.mjs's own "skip if not built
// yet" behavior so `vitest run` alone (no real HTTP calls, no build
// dependency) still passes standalone.

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "web/dist");

describe("B4 지도 코드 스플리팅 — 빌드 산출물 검증 (dist 있을 때만)", () => {
  it("dist가 있으면 MapView 청크가 index.html에서 직접 참조되지 않는다", () => {
    if (!existsSync(DIST_DIR)) return; // build not run in this session; skip gracefully
    const indexHtml = readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
    const assetFiles = readdirSync(path.join(DIST_DIR, "assets"));
    const mapViewChunk = assetFiles.find((f) => f.startsWith("MapView-") && f.endsWith(".js"));
    expect(mapViewChunk, "MapView chunk should exist in a real build").toBeTruthy();
    if (mapViewChunk) {
      expect(indexHtml).not.toContain(mapViewChunk);
    }
  });

  it("dist가 있으면 메인 번들에 leaflet 소스가 없다 (전부 지연 청크로 격리)", () => {
    if (!existsSync(DIST_DIR)) return;
    const assetFiles = readdirSync(path.join(DIST_DIR, "assets"));
    const mainChunk = assetFiles.find((f) => f.startsWith("index-") && f.endsWith(".js"));
    if (!mainChunk) return;
    const content = readFileSync(path.join(DIST_DIR, "assets", mainChunk), "utf8");
    expect(content.toLowerCase()).not.toContain("leaflet");
  });
});
