import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPwaUpdate } from "./pwaUpdate";
import { cssVar } from "./design/token";

// See pwaUpdate.ts for why this call is required — registerType:
// "autoUpdate" in vite.config.ts alone does not reload already-open tabs.
initPwaUpdate();

// theme-color 는 CSS 변수를 못 받는 자리라 토큰에서 읽어 채운다.
// index.html 에 색을 박으면 tokens.css 와 갈라진다.
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute("content", cssVar("--color-accent"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
