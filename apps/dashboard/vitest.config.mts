import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// First JS/TS test runner for apps/dashboard (Story 2.10 QA automation --
// this app previously had no automated test runner at all, confirmed by
// every prior story's Testing Standards note). Vitest chosen over Jest for
// native ESM/TS support with no transpile config, matching this app's
// bundler moduleResolution. Alias mirrors tsconfig.json's "@/*" -> "./*".
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": dirname,
    },
  },
});
