import { defineConfig } from "vitest/config";

// Story 24.10: the layout stage of the conformance suite. It launches headless Chromium (Playwright) and FAILS when the browser is missing:
// there is no skip. Install it with `npx playwright install chromium`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.layout.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
