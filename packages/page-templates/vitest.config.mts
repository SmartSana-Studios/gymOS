import { defineConfig } from "vitest/config";

// Story 24.10: unit and DOM-level conformance tests (jsdom is imported where needed). The Chromium layout stage has its own config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "src/**/*.layout.test.ts"],
    testTimeout: 20_000,
  },
});
