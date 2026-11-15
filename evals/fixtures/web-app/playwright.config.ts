import { defineConfig } from "@playwright/test";

// The page is static: start it with `python -u -m http.server 8770 --bind 127.0.0.1`.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:8770" },
});
