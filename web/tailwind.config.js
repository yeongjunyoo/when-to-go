/** @type {import('tailwindcss').Config} */
// 테마는 손으로 적지 않는다. src/design/tokens.css 를 파싱해 거기서 만든다.
// 값이 사는 곳이 한 군데뿐이어야 드리프트할 곳이 없다.
//
// colors 는 extend 가 아니라 **덮어쓴다.** 그래야 Tailwind 기본 팔레트
// (bg-gray-50, text-blue-800 …) 클래스가 애초에 생성되지 않는다. 금지 규칙을
// 검사기로 뒤늦게 잡는 것보다 존재하지 않게 만드는 편이 확실하다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.join(here, "src", "design", "tokens.css");

/** tokens.css 의 :root 블록에서 `--name: value` 를 뽑는다. */
function readTokenNames() {
  const css = readFileSync(tokensPath, "utf8");
  const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("@media"));
  const names = new Set();
  for (const m of rootBlock.matchAll(/--([a-z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

const tokenNames = readTokenNames();

/** 토큰이 실제로 정의돼 있는지 확인하고 var() 참조를 돌려준다.
 *  오타로 없는 토큰을 참조하면 조용히 투명해지므로 빌드 때 터뜨린다. */
function v(name) {
  if (!tokenNames.has(name)) {
    throw new Error(
      `tailwind.config.js: --${name} 이 src/design/tokens.css 에 없다. ` +
        `토큰을 먼저 추가하라.`,
    );
  }
  return `var(--${name})`;
}

/** bg/border/fg 세 쌍으로만 쓰는 상태색 묶음 */
function statusTriplet(kind) {
  return {
    DEFAULT: v(`color-${kind}-bg`),
    bg: v(`color-${kind}-bg`),
    border: v(`color-${kind}-border`),
    fg: v(`color-${kind}-fg`),
  };
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // ── 색: 덮어쓴다 (기본 팔레트 제거) ──────────────────────────────────
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",

      canvas: v("color-canvas"),
      surface: {
        DEFAULT: v("color-surface"),
        sunken: v("color-surface-sunken"),
        hover: v("color-surface-hover"),
      },

      // 테두리는 border-default / border-strong 으로 쓴다
      default: v("color-border"),
      strong: v("color-border-strong"),

      text: {
        DEFAULT: v("color-text"),
        muted: v("color-text-muted"),
        subtle: v("color-text-subtle"),
        "on-accent": v("color-text-on-accent"),
      },

      accent: {
        DEFAULT: v("color-accent"),
        hover: v("color-accent-hover"),
        subtle: v("color-accent-subtle"),
        border: v("color-accent-border"),
      },

      focus: v("color-focus"),

      info: statusTriplet("info"),
      success: statusTriplet("success"),
      warn: statusTriplet("warn"),
      danger: statusTriplet("danger"),

      // 혼잡도 — 제품의 핵심 시각 언어
      congestion: {
        low: v("color-congestion-low"),
        mid: v("color-congestion-mid"),
        high: v("color-congestion-high"),
        none: v("color-congestion-none"),
      },
      heat: {
        1: v("color-heat-1"),
        2: v("color-heat-2"),
        3: v("color-heat-3"),
        4: v("color-heat-4"),
        5: v("color-heat-5"),
        empty: v("color-heat-empty"),
      },
    },

    // ── 타이포 ────────────────────────────────────────────────────────────
    fontFamily: {
      sans: v("font-sans"),
      numeric: v("font-numeric"),
    },
    fontSize: {
      xs: [v("text-xs"), { lineHeight: v("leading-normal") }],
      sm: [v("text-sm"), { lineHeight: v("leading-normal") }],
      base: [v("text-base"), { lineHeight: v("leading-normal") }],
      lg: [v("text-lg"), { lineHeight: v("leading-tight") }],
      xl: [v("text-xl"), { lineHeight: v("leading-tight") }],
      "2xl": [v("text-2xl"), { lineHeight: v("leading-tight") }],
      "3xl": [v("text-3xl"), { lineHeight: v("leading-tight") }],
    },
    fontWeight: {
      normal: v("weight-normal"),
      medium: v("weight-medium"),
      semibold: v("weight-semibold"),
      bold: v("weight-bold"),
    },
    lineHeight: {
      tight: v("leading-tight"),
      normal: v("leading-normal"),
      relaxed: v("leading-relaxed"),
    },

    // ── 형태 ──────────────────────────────────────────────────────────────
    borderRadius: {
      none: "0",
      sm: v("radius-sm"),
      md: v("radius-md"),
      lg: v("radius-lg"),
      xl: v("radius-xl"),
      full: v("radius-full"),
    },
    boxShadow: {
      none: "none",
      sm: v("shadow-sm"),
      md: v("shadow-md"),
      lg: v("shadow-lg"),
    },

    // 간격은 Tailwind 기본 4px 스케일을 그대로 쓴다 — tokens.css 의 --space-*
    // 와 값이 일치한다(space-2 = 0.5rem). 날 CSS 에서는 --space-* 를 쓴다.
    extend: {
      maxWidth: {
        content: v("width-content"),
        wide: v("width-wide"),
      },
      transitionDuration: {
        fast: v("motion-fast"),
        base: v("motion-base"),
      },
      transitionTimingFunction: {
        standard: v("motion-ease"),
      },
    },
  },
  plugins: [],
};
