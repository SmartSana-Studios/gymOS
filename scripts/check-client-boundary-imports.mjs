#!/usr/bin/env node
// Epic 24 retro (D1, PR #123): a Server Component that imports a VALUE from a "use client" module does not get that value. Next.js hands it
// a client reference, so `PAGES_TABS.includes(...)` threw while rendering on Vercel (React error #441, nothing in the logs but a blank 500).
// jsdom unit tests do not enforce the boundary, so nothing caught it before production.
//
// This gate scans apps/*/ for that shape. For every file that is NOT itself a client module (no "use client" directive), each static import
// from a file that IS a client module must bring in only
//   - types (`import type`, or `{ type X }`),
//   - a component, recognised by name: PascalCase with at least one lowercase letter (`PagesClient`), as a named or default import.
// Anything else is a violation: a CONSTANT (`PAGES_TABS`), a function or hook (`useThing`, `parseTab`), or a namespace import (`* as ns`).
// A server file that really needs such a value should import it from a plain module (the fix in 5fc8112 moved it to `tabs.ts`).
// Known limits, so a pass is not read as more than it is: a PascalCase non-component export (a class, a lookup object) is not caught;
// barrel re-exports, dynamic `import()` and `require` are not followed; test files are skipped.
// Escape hatch for a reviewed exception: put `// client-boundary: allow <reason>` on the line above the import.
// Plain Node, zero dependencies. Exit 1 with one line per violation naming file, line, module and binding.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "build", "coverage", "e2e", "__tests__", ".vercel", "playwright-report", "test-results"]);
const SOURCE = /\.(ts|tsx|mts|js|jsx|mjs)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/** True when the first statement of the source is a "use client" directive (comments and blank lines before it are allowed). */
export function isClientModule(text) {
  let s = text.replace(/^﻿/, "");
  for (;;) {
    s = s.replace(/^\s+/, "");
    if (s.startsWith("//")) s = s.replace(/^\/\/[^\n]*/, "");
    else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end < 0) return false;
      s = s.slice(end + 2);
    } else break;
  }
  return /^(["'])use client\1/.test(s);
}

/** A component name: PascalCase with at least one lowercase letter. `PAGES_TABS`, `TABS`, `useThing` and `parseTab` are not. */
export const isComponentName = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

/** Static imports of a source text: [{ line, spec, typeOnly, defaultName, namespace, named: [{ name, typeOnly }], allowed }]. */
export function parseImports(text) {
  const out = [];
  const re = /(^|\n)[ \t]*import\s+(type\s+)?([^"';]*?)\s*from\s*(["'])([^"'\n]+)\4\s*;?/g;
  let m;
  while ((m = re.exec(text))) {
    const head = m[3];
    const line = text.slice(0, m.index + m[1].length).split("\n").length;
    const prev = text.split("\n")[line - 2] ?? "";
    const item = { line, spec: m[5], typeOnly: Boolean(m[2]), defaultName: null, namespace: null, named: [], allowed: /\/\/\s*client-boundary:\s*allow\b/.test(prev) };
    let rest = head.trim();
    const ns = rest.match(/^(?:([\w$]+)\s*,\s*)?\*\s*as\s+([\w$]+)$/);
    if (ns) {
      item.defaultName = ns[1] ?? null;
      item.namespace = ns[2];
    } else {
      const braces = rest.match(/\{([\s\S]*)\}/);
      if (braces) {
        for (const part of braces[1].split(",")) {
          const p = part.trim();
          if (!p) continue;
          const typeOnly = /^type\s+/.test(p);
          const name = p.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
          item.named.push({ name, typeOnly });
        }
        rest = rest.replace(/\{[\s\S]*\}/, "").replace(/,\s*$/, "").trim();
      }
      const d = rest.replace(/,$/, "").trim();
      if (d) item.defaultName = d;
    }
    out.push(item);
  }
  return out;
}

function tsconfigAlias(appDir) {
  const f = join(appDir, "tsconfig.json");
  if (!existsSync(f)) return null;
  try {
    const cfg = JSON.parse(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
    const paths = cfg.compilerOptions?.paths ?? {};
    const base = resolve(appDir, cfg.compilerOptions?.baseUrl ?? ".");
    const target = paths["@/*"]?.[0];
    return target ? resolve(base, target.replace(/\*$/, "")) : null;
  } catch {
    return null;
  }
}

function resolveImport(fromFile, spec, aliasRoot) {
  let base;
  if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith("@/") && aliasRoot) base = join(aliasRoot, spec.slice(2));
  else return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    const f = base + suffix;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SOURCE.test(name) && !TEST_FILE.test(name) && !name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

/** Violations for the app directories given: [{ file, line, spec, binding }] with `file` relative to `root`. */
export function scanApps(root, appDirs) {
  const violations = [];
  for (const appDir of appDirs) {
    const aliasRoot = tsconfigAlias(appDir);
    const files = walk(appDir);
    const clientCache = new Map();
    const isClient = (f) => {
      if (!clientCache.has(f)) clientCache.set(f, isClientModule(readFileSync(f, "utf8")));
      return clientCache.get(f);
    };
    for (const file of files) {
      if (isClient(file)) continue; // client -> client is fine; the boundary is crossed only from the server side
      const text = readFileSync(file, "utf8");
      if (!/from\s*["']/.test(text)) continue;
      for (const imp of parseImports(text)) {
        if (imp.typeOnly || imp.allowed) continue;
        const target = resolveImport(file, imp.spec, aliasRoot);
        if (!target || !isClient(target)) continue;
        const bad = [];
        if (imp.namespace) bad.push(`* as ${imp.namespace}`);
        if (imp.defaultName && !isComponentName(imp.defaultName)) bad.push(`default ${imp.defaultName}`);
        for (const n of imp.named) if (!n.typeOnly && !isComponentName(n.name)) bad.push(n.name);
        for (const binding of bad) violations.push({ file: relative(root, file), line: imp.line, spec: imp.spec, binding });
      }
    }
  }
  return violations;
}

export function appDirsOf(root) {
  const apps = join(root, "apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps)
    .map((n) => join(apps, n))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "package.json")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : repoRoot;
  const found = scanApps(root, appDirsOf(root));
  if (found.length) {
    for (const v of found) {
      console.error(`${v.file}:${v.line}: imports the value \`${v.binding}\` from the "use client" module ${v.spec}; a Server Component receives only a client reference (React #441). Move it to a plain module, or add \`// client-boundary: allow <reason>\` above the import.`);
    }
    process.exit(1);
  }
  console.log(`client-boundary imports: OK (${appDirsOf(root).length} apps scanned)`);
}
