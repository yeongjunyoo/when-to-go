import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// B6 접근성 점검 — 시맨틱 마크업, 색만으로 정보를 전달하지 않는지(핀 색 +
// 텍스트 병기), 로딩/오류 상태에 role/aria-live가 붙어 있는지를 소스 계약
// 수준에서 고정한다. 이 저장소에는 jsdom/testing-library 인프라가 없어
// 렌더 트리를 직접 조회할 수 없으므로, 렌더되는 JSX 소스에 필요한
// 접근성 속성/문구가 실재하는지 정적으로 검사한다.

const ROOT = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("로딩·오류 상태에 role/aria-live 계열 속성이 붙어 있다", () => {
  it("App.tsx의 모든 상태 배너가 StatusBox(role) 또는 명시적 role/aria-live를 사용한다", () => {
    const content = readSrc("web/src/App.tsx");
    // StatusBox 자체가 role="status"|"alert"를 강제하는 컴포넌트다 — 사용처가
    // 전부 그 컴포넌트나 명시적 role/aria-live를 갖는지 확인.
    const statusBoxUsages = content.match(/<StatusBox\s+role=/g) ?? [];
    expect(statusBoxUsages.length).toBeGreaterThan(5);
    // 점진 렌더 상태(collecting)는 StatusBox가 아니라 별도 div이므로 개별 확인.
    expect(content).toMatch(/status.*==.*"collecting"[\s\S]{0,80}role="status"/);
    expect(content).toMatch(/aria-live="polite"/);
  });

  it("StatusBox 컴포넌트 자체가 role prop을 그대로 DOM에 전달한다(누락 없음)", () => {
    const content = readSrc("web/src/App.tsx");
    expect(content).toMatch(/function StatusBox\(\{ role,/);
    expect(content).toMatch(/<div role=\{role\}/);
  });

  it("AttractionDetail.tsx의 상태 배너(신선도·배지·수집중)에 role이 붙어 있다", () => {
    const content = readSrc("web/src/AttractionDetail.tsx");
    const roleCount = (content.match(/role="status"|role="alert"/g) ?? []).length;
    expect(roleCount).toBeGreaterThanOrEqual(4); // 신선도, 배지(true/null), 수집중
  });

  it("PoiMatch.tsx의 4경로 상태 배너에 role이 붙어 있다", () => {
    const content = readSrc("web/src/PoiMatch.tsx");
    const roleCount = (content.match(/role="status"|role="alert"/g) ?? []).length;
    expect(roleCount).toBeGreaterThanOrEqual(4);
  });
});

describe("선택 상태가 색상에만 의존하지 않는다 (aria-pressed + sr-only 텍스트)", () => {
  it("시도/관광지 선택 버튼에 aria-pressed가 있다", () => {
    const content = readSrc("web/src/App.tsx");
    expect(content).toMatch(/aria-pressed=\{selectedSido\?\.code === region\.code\}/);
    expect(content).toMatch(/aria-pressed=\{selectedAttraction === attraction\.tAtsNm\}/);
  });

  it("선택된 항목에 스크린리더 전용 텍스트가 병기된다 (색만으로 전달하지 않는다)", () => {
    const content = readSrc("web/src/App.tsx");
    expect(content).toMatch(/sr-only/);
  });
});

describe("지도 핀 색이 텍스트와 병기된다 (색맹 사용자도 정보를 얻는다)", () => {
  it("MapView.tsx가 핀 색상 정보를 텍스트 목록으로도 제공한다", () => {
    const content = readSrc("web/src/MapView.tsx");
    expect(content).toMatch(/지도 핀 목록/);
    expect(content).toMatch(/pinTierLabel/);
  });

  it("범례가 색상 스와치와 텍스트 라벨을 함께 표시한다", () => {
    const content = readSrc("web/src/MapView.tsx");
    // 색상 스와치(span with backgroundColor) 옆에 반드시 한글 라벨 텍스트가 붙는다.
    expect(content).toMatch(/저집중일/);
    expect(content).toMatch(/고집중/);
  });

  it("지도 컨테이너에 role/aria-label이 있다 (스크린리더가 순수 시각 요소로 건너뛰지 않는다)", () => {
    const content = readSrc("web/src/MapView.tsx");
    expect(content).toMatch(/role="application"/);
    expect(content).toMatch(/aria-label="관광지 지도"/);
  });
});

describe("시맨틱 마크업 — section/heading 구조", () => {
  it("App.tsx의 주요 화면 블록이 <section aria-label> + <h2>로 구성된다", () => {
    const content = readSrc("web/src/App.tsx");
    const sectionCount = (content.match(/<section aria-label=/g) ?? []).length;
    expect(sectionCount).toBeGreaterThanOrEqual(4); // 시도/시군구/세종안내/관광지목록 최소
    const h2Count = (content.match(/<h2/g) ?? []).length;
    expect(h2Count).toBeGreaterThanOrEqual(2);
  });

  it("모든 버튼이 type=\"button\"을 명시한다 (form 안에서 실수로 submit 트리거되는 것을 방지)", () => {
    const content = readSrc("web/src/App.tsx");
    const buttonOpenTags = content.match(/<button\b[^>]*>/g) ?? [];
    for (const tag of buttonOpenTags) {
      expect(tag, `button missing type="button": ${tag}`).toMatch(/type="button"/);
    }
  });
});

describe("키보드 내비게이션 — 클릭 핸들러가 네이티브 상호작용 요소에 붙어 있다", () => {
  it("선택 가능한 항목은 div/span의 onClick이 아니라 <button>에 onClick이 붙는다", () => {
    for (const file of ["web/src/App.tsx", "web/src/AttractionDetail.tsx", "web/src/PoiMatch.tsx"]) {
      const content = readSrc(file);
      // <div onClick 또는 <span onClick 같은 비-상호작용 요소 클릭 핸들러가 없어야
      // 키보드 사용자가 Tab/Enter로 도달·조작할 수 있다.
      expect(content, `${file} attaches onClick to a non-interactive element`).not.toMatch(/<div[^>]*\bonClick=/);
      expect(content, `${file} attaches onClick to a non-interactive element`).not.toMatch(/<span[^>]*\bonClick=/);
    }
  });
});
