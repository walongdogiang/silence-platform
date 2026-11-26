import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as { version: string };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, "src/main/index.ts") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, "src/preload/index.ts") },
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
          inlineDynamicImports: true,
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    // Dev cold start: transform the module graph as soon as the server is up (instead of when
    // Electron first requests the page), and pre-bundle Monaco up front. Monaco is only reached
    // via dynamic import, so without `include` Vite discovers it late, re-optimizes and reloads.
    server: { warmup: { clientFiles: ["./main.tsx", "./App.tsx"] } },
    optimizeDeps: { include: ["monaco-editor", "@monaco-editor/react"] },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
