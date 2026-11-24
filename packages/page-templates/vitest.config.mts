import { defineConfig } from "vitest/config";

// Story 24.10: unit and DOM-level conformance tests (jsdom is imported where needed). The Chromium layout stage has its own config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "src/**/*.layout.test.ts"],
    // The registered-template conformance tests are CPU-bound jsdom work (about 25 s on a busy 4-core machine); 20 s flaked in ci-local whenever the turbo cache missed under load. Failure is still a violation list, never a timeout.
    testTimeout: 90_000,
  },
});
