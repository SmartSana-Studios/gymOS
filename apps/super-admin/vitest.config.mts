import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// First JS/TS test runner for apps/super-admin (Story 16.1) -- this app
// previously had no automated test runner at all. Mirrors apps/dashboard's
// vitest.config.mts (Story 2.10) exactly, including the tsconfig.json
// "@/*" -> "./*" alias.
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
