import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appDirsOf, isClientModule, isComponentName, parseImports, scanApps } from "../check-client-boundary-imports.mjs";

const script = fileURLToPath(new URL("../check-client-boundary-imports.mjs", import.meta.url));

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "boundary-"));
  writeFileSync(join(root, "marker"), "");
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/web/package.json"), "{}");
  for (const [name, text] of Object.entries(files)) {
    const f = join(root, "apps/web", name);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return root;
}
const scan = (files) => {
  const root = repo(files);
  return { root, found: scanApps(root, appDirsOf(root)) };
};

const CLIENT = `"use client";\nexport const PAGES_TABS = ["a"] as const;\nexport function parseTab(v: string) { return v; }\nexport function PagesClient() { return null; }\nexport type PagesTab = "a";\nexport default function Panel() { return null; }\n`;

test("the PR 123 shape fails: a Server Component imports a constant from a client module", () => {
  const { found } = scan({ "app/page.tsx": `import { PagesClient, PAGES_TABS } from "./PagesClient";\nexport default function P() { return PAGES_TABS.includes("a"); }\n`, "app/PagesClient.tsx": CLIENT });
  assert.deepEqual(found.map((v) => v.binding), ["PAGES_TABS"]);
  assert.equal(found[0].line, 1);
});

test("functions, hooks and namespace imports from a client module fail", () => {
  const { found } = scan({
    "app/a.tsx": `import { parseTab } from "./PagesClient";\n`,
    "app/b.tsx": `import * as client from "./PagesClient";\n`,
    "app/c.tsx": `import Thing, { useThing } from "./hooks";\n`,
    "app/PagesClient.tsx": CLIENT,
    "app/hooks.tsx": `"use client";\nexport const useThing = () => 1;\nexport default function Thing() { return null; }\n`,
  });
  assert.deepEqual(found.map((v) => v.binding).sort(), ["* as client", "parseTab", "useThing"].sort());
});

test("components, default components and types pass", () => {
  const { found } = scan({
    "app/page.tsx": `import Panel, { PagesClient, type PagesTab } from "./PagesClient";\nimport type { PAGES_TABS } from "./PagesClient";\nexport const x: PagesTab = "a";\n`,
    "app/PagesClient.tsx": CLIENT,
  });
  assert.deepEqual(found, []);
});

test("a client module importing from a client module is fine (the boundary is crossed only from the server side)", () => {
  const { found } = scan({ "app/Other.tsx": `"use client";\nimport { PAGES_TABS, parseTab } from "./PagesClient";\n`, "app/PagesClient.tsx": CLIENT });
  assert.deepEqual(found, []);
});

test("a plain module is not a client module, so importing its values is fine", () => {
  const { found } = scan({ "app/page.tsx": `import { PAGES_TABS } from "./tabs";\n`, "app/tabs.ts": `export const PAGES_TABS = ["a"] as const;\n` });
  assert.deepEqual(found, []);
});

test("the @/ alias resolves through the app's tsconfig", () => {
  const files = { "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`, "app/page.tsx": `import { PAGES_TABS } from "@/components/PagesClient";\n`, "components/PagesClient.tsx": CLIENT };
  const { found } = scan(files);
  assert.deepEqual(found.map((v) => v.binding), ["PAGES_TABS"]);
});

test("a reviewed exception passes with the pragma on the line above, and only that import", () => {
  const { found } = scan({
    "app/page.tsx": `// client-boundary: allow only the string is read, never called on the server\nimport { PAGES_TABS } from "./PagesClient";\nimport { parseTab } from "./PagesClient";\n`,
    "app/PagesClient.tsx": CLIENT,
  });
  assert.deepEqual(found.map((v) => v.binding), ["parseTab"]);
});

test("test files are skipped", () => {
  const { found } = scan({ "app/page.test.tsx": `import { PAGES_TABS } from "./PagesClient";\n`, "app/PagesClient.tsx": CLIENT });
  assert.deepEqual(found, []);
});

test("directive detection allows leading comments, rejects a directive that is not first", () => {
  assert.equal(isClientModule(`// header\n/* block */\n"use client"\nexport {}`), true);
  assert.equal(isClientModule(`'use client';\n`), true);
  assert.equal(isClientModule(`import x from "y";\n"use client";\n`), false);
  assert.equal(isClientModule(`export const s = "use client";\n`), false);
});

test("component names: PascalCase with a lowercase letter only", () => {
  for (const ok of ["PagesClient", "Panel", "A1b"]) assert.equal(isComponentName(ok), true, ok);
  for (const bad of ["PAGES_TABS", "TABS", "useThing", "parseTab", "A"]) assert.equal(isComponentName(bad), false, bad);
});

test("parseImports handles multi-line clauses and side-effect imports", () => {
  const imps = parseImports(`import "./styles.css";\nimport {\n  A,\n  type B,\n  c as d,\n} from "./x";\n`);
  assert.equal(imps.length, 1);
  assert.deepEqual(imps[0].named, [{ name: "A", typeOnly: false }, { name: "B", typeOnly: true }, { name: "c", typeOnly: false }]);
  assert.equal(imps[0].line, 2);
});

test("the CLI exits 1 with a file:line message on a violation and 0 on a clean tree", () => {
  const bad = repo({ "app/page.tsx": `import { PAGES_TABS } from "./PagesClient";\n`, "app/PagesClient.tsx": CLIENT });
  const r = spawnSync(process.execPath, [script, bad], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /app\/page\.tsx:1: imports the value `PAGES_TABS`/);
  const good = repo({ "app/page.tsx": `import { PagesClient } from "./PagesClient";\n`, "app/PagesClient.tsx": CLIENT });
  const ok = spawnSync(process.execPath, [script, good], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /OK/);
});

test("the real repo passes (Epic 24 retro D1)", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
