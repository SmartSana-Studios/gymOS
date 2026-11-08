#!/usr/bin/env node
// Story 24.2 (AD-43): the apps must not be tied to one host. VERCEL_ENV and VERCEL_GIT_COMMIT_SHA are read in exactly one module
// per app (lib/app-env.ts), which prefers the host-neutral APP_ENV / GIT_SHA and falls back to the Vercel names. This gate fails
// when any other source file under apps/ or packages/ reads either variable. Whole-line comments are skipped; test files,
// node_modules, .next and docs are not scanned. VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL and VERCEL_FORCE_BUILD are out of scope.
// Plain Node, zero dependencies. Exit 1 with one line per violation (file:line).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const VARS = /\b(VERCEL_ENV|VERCEL_GIT_COMMIT_SHA)\b/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build", "coverage", ".expo"]);
export const ALLOWED = /^apps\/[^/]+\/lib\/app-env\.ts$/;

/**
 * Blank out whole-line comments, keeping line count. Fails closed: a line is a comment only when its trimmed text starts with //,
 * or it sits inside a block comment that began a trimmed line with /* (tracked across lines). Strings, regex literals and trailing
 * comments are NOT parsed, so a mention after code may be flagged (acceptable) but code is never hidden by a misread literal.
 */
export function stripComments(src) {
  let inBlock = false;
  return src
    .split("\n")
    .map((line) => {
      let rest = line;
      if (!inBlock) {
        const t = line.trim();
        if (t.startsWith("//")) return "";
        if (!t.startsWith("/*")) return line;
        inBlock = true;
        rest = t.slice(2);
      }
      const end = rest.indexOf("*/");
      if (end === -1) return "";
      inBlock = false;
      return rest.slice(end + 2); // code after the closing */ on the same line still counts
    })
    .join("\n");
}

export function isTestFile(path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path);
}

/** Violations for [{ path, text }] (paths repo-relative, forward slashes). */
export function scanFiles(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (ALLOWED.test(path) || isTestFile(path)) continue;
    stripComments(text)
      .split("\n")
      .forEach((line, idx) => {
        const m = line.match(VARS);
        if (m) problems.push(`${path}:${idx + 1}: reads ${m[1]} directly; go through lib/app-env.ts (appEnvironment / buildId)`);
      });
  }
  return problems;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

export function scanRepo(root = repoRoot) {
  const files = [...walk(join(root, "apps")), ...walk(join(root, "packages"))].map((p) => ({
    path: relative(root, p).split("\\").join("/"),
    text: readFileSync(p, "utf8"),
  }));
  return scanFiles(files);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = scanRepo();
  if (problems.length > 0) {
    console.error("host-neutral env check FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("host-neutral env check OK: VERCEL_ENV and VERCEL_GIT_COMMIT_SHA are read only in lib/app-env.ts.");
}
