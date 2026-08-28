import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPwaUpdate } from "./pwaUpdate";

// See pwaUpdate.ts for why this call is required — registerType:
// "autoUpdate" in vite.config.ts alone does not reload already-open tabs.
initPwaUpdate();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
