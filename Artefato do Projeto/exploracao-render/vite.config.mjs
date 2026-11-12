import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      shiki: fileURLToPath(new URL("./src/shims/shiki.js", import.meta.url)),
    },
  },
  build: {
    outDir: "site",
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2500,
  },
});
