import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PAGES_TABS, parsePagesTab } from "./tabs";

describe("parsePagesTab", () => {
  it("keeps a known tab and falls back to names", () => {
    for (const tab of PAGES_TABS) expect(parsePagesTab(tab)).toBe(tab);
    expect(parsePagesTab("nope")).toBe("names");
    expect(parsePagesTab(undefined)).toBe("names");
    expect(parsePagesTab(null)).toBe("names");
  });
});

describe("server/client boundary", () => {
  it("page.tsx imports only the component (no values) from the client module", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const fromClient = page.match(/import\s+\{([^}]*)\}\s+from\s+"\.\/components\/PagesClient"/);
    expect(fromClient?.[1]?.replace(/type\s+\w+/g, "").split(",").map((s) => s.trim()).filter(Boolean)).toEqual(["PagesClient"]);
  });
  it("tabs.ts stays a plain module", () => {
    expect(readFileSync(join(__dirname, "tabs.ts"), "utf8")).not.toMatch(/^\s*["']use client["']/m);
  });
});
