import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// No `test.globals: true` in vitest.config.mts (every other test file imports
// describe/it/expect explicitly) -- @testing-library/react's own auto-cleanup
// only self-registers when it detects a global test framework, so without
// this every component test file would leak its rendered DOM into the next
// test in the same file.
afterEach(cleanup);
