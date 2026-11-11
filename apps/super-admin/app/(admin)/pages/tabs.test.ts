import { existsSync, readFileSync } from "node:fs";
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

describe("server/client boundary, every import of page.tsx", () => {
  it("takes only components (and types) from any \"use client\" module, never a value", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const imports = [...page.matchAll(/import\s+\{([^}]*)\}\s+from\s+"(\.[^"]*)"/g)];
    expect(imports.length).toBeGreaterThan(0);
    let clientModules = 0;
    for (const [, names, spec] of imports) {
      const base = join(__dirname, spec!);
      const file = [`${base}.tsx`, `${base}.ts`].find((f) => existsSync(f));
      if (!file || !/^\s*["']use client["']/m.test(readFileSync(file, "utf8"))) continue;
      clientModules += 1;
      const values = names!.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type "));
      // PAGES_TABS starts with a capital too: a component is PascalCase, so it needs a lower-case letter as well. `X as Y` is judged by X.
      for (const v of values.map((x) => x.split(/\s+as\s+/)[0]!.trim())) expect(v, `${spec}: ${v} is a value imported from a client module`).toMatch(/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/);
    }
    expect(clientModules).toBeGreaterThan(0);
  });
});

describe("the Pages screens and their database functions", () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
  const rpcNames = (src: string) => [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);

  it("the screens call exactly these functions, and every one is in the generated database types", () => {
    const called = [...new Set([...rpcNames(read("actions.ts")), ...rpcNames(read("../page-names/actions.ts"))])].sort();
    expect(called).toEqual([
      "close_page_report", "decide_held_page_name", "decide_page_appeal", "get_gym_page_name", "get_gym_page_status", "lift_gym_page_takedown",
      "list_held_page_names", "list_page_appeals", "list_page_reports", "list_published_pages", "take_down_gym_page",
    ]);
    const types = readFileSync(join(__dirname, "../../../../../packages/types/src/database.ts"), "utf8");
    for (const fn of called) expect(types, fn).toMatch(new RegExp(`^\\s{6}${fn}: \\{`, "m"));
  });

  it("list_published_pages has its consumer chain: action, page.tsx, PagesClient and the Active panel", () => {
    expect(read("actions.ts")).toMatch(/export async function listActivePages[\s\S]*?\.rpc\("list_published_pages"\)/);
    expect(read("page.tsx")).toMatch(/listActivePages\(\)/);
    expect(read("page.tsx")).toMatch(/active=\{active\.error \? null : active\.data\}/);
    // an Active failure must not take the other three tabs down: the all-or-nothing load error covers held, reports and appeals only
    expect(read("page.tsx")).not.toMatch(/active\.error \|\| !active\.data/);
    expect(read("components/PagesClient.tsx")).toMatch(/<ActivePagesPanel rows=\{active\}/);
  });
});
