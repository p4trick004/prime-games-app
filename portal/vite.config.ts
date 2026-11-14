import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: "../web/app",
    emptyOutDir: true,
    assetsDir: "portal-assets",
    sourcemap: false,
  },
  server: {
    port: 4175,
    proxy: {
      "/functions": "http://127.0.0.1:4174",
    },
  },
});
