import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "언제 가지",
        short_name: "언제가지",
        description: "공공데이터 기반 관광 혼잡도 안내",
        theme_color: "#111827",
        background_color: "#ffffff",
        display: "standalone",
        icons: [],
      },
    }),
  ],
});
