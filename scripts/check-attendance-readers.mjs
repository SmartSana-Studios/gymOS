#!/usr/bin/env node
// Story 27.1 (AD-56): every attendance count reads attendance_counted / member_visit_days, never the base table, so a voided visit can
// never be counted by one query and not another. This gate fails when app code reads the base table with
//   .from("attendance_events")   (also 'attendance_events' and `attendance_events`, with any whitespace or line breaks, and a type
//   argument such as .from<Row>(...) or .from <Row> (...))
// outside the committed baseline (scripts/attendance-readers.baseline.json). Scans apps, packages and supabase/functions.
// The database half of the gate (function bodies, policies, views) is supabase/tests/attendance_counting.test.sql.
//
// The baseline is hand-edited; this script never writes it. Each entry is { file, count, reason }: the exact number of base-table reads the
// file may hold, and a one-line reason. A file whose found count differs (a second read added, or one removed) fails, and a listed file that
// no longer reads the table is a stale entry and also fails, so the list can only shrink as readers move to the view.
// Plain Node, zero dependencies. Exit 1 with one line per violation naming file and line.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const SCAN_DIRS = ["apps", "packages", "supabase/functions"];
export const DEFAULT_BASELINE = join(repoRoot, "scripts/attendance-readers.baseline.json");

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".expo", "dist", "build", "coverage", "playwright-report", "test-results", ".git"]);
const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const READER_RE = /\.from\s*(?:<[^()]*>)?\s*\(\s*(["'`])attendance_events\1\s*,?\s*\)/g;

/** Line numbers (1-based) of every base-table read in one file's text. */
export function findReaders(text) {
  const lines = [];
  for (const m of text.matchAll(READER_RE)) lines.push(text.slice(0, m.index).split("\n").length);
  return lines;
}

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && SOURCE_EXT.test(name)) yield full;
  }
}

/** Map of repo-relative file (forward slashes) -> line numbers, across the scan directories under `root`. */
export function scanReaders(root = repoRoot, dirs = SCAN_DIRS) {
  const found = new Map();
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      const lines = findReaders(readFileSync(file, "utf8"));
      if (lines.length) found.set(relative(root, file).split(sep).join("/"), lines);
    }
  }
  return found;
}

/** Violation lines for a scan result against a parsed baseline. */
export function checkReaders(found, baseline) {
  const out = [];
  const entries = Array.isArray(baseline?.entries) ? baseline.entries : null;
  if (!entries) return ["baseline must be an object with an `entries` array"];
  const listed = new Map();
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e.file !== "string" || !e.file) {
      out.push(`baseline entry ${i}: missing "file"`);
      continue;
    }
    if (!Number.isInteger(e.count) || e.count < 1) {
      out.push(`baseline entry ${e.file}: needs a positive integer "count" (the exact number of allowlisted reads)`);
    }
    if (typeof e.reason !== "string" || !e.reason.trim() || e.reason.includes("\n")) {
      out.push(`baseline entry ${e.file}: needs a one-line "reason"`);
    }
    listed.set(e.file, e);
  }
  for (const [file, lines] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    if (listed.has(file)) {
      const expected = listed.get(file).count;
      if (Number.isInteger(expected) && expected >= 1 && expected !== lines.length) {
        out.push(
          `${file}:${lines.join(",")}: holds ${lines.length} base-table read(s) of attendance_events but the baseline allows ${expected}. ` +
            `Read attendance_counted or member_visit_days for the new read, or update the count in scripts/attendance-readers.baseline.json with a reason.`,
        );
      }
    } else {
      out.push(
        `${file}:${lines.join(",")}: reads the base table attendance_events. Read attendance_counted or member_visit_days instead (a voided visit must not be counted); ` +
          `if this reader truly needs the base table, add it to scripts/attendance-readers.baseline.json with a one-line reason.`,
      );
    }
  }
  for (const file of [...listed.keys()].sort()) {
    if (!found.has(file)) out.push(`Stale baseline entry: ${file} no longer reads attendance_events; remove it from scripts/attendance-readers.baseline.json.`);
  }
  return out;
}

function main(argv) {
  let root = repoRoot;
  let baselinePath = DEFAULT_BASELINE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "--baseline") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      if (a === "--root") root = resolve(v);
      else baselinePath = resolve(v);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!existsSync(baselinePath)) {
    console.error(`Baseline not found: ${baselinePath}`);
    process.exit(2);
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (e) {
    console.error(`Cannot read baseline ${baselinePath}: ${e.message}`);
    process.exit(2);
  }
  if (!SCAN_DIRS.some((d) => existsSync(join(root, d)))) {
    console.error(`None of ${SCAN_DIRS.join(", ")} exist under ${root}; refusing to pass on an empty scan.`);
    process.exit(2);
  }
  const found = scanReaders(root);
  const violations = checkReaders(found, baseline);
  if (violations.length) {
    console.error("Attendance reader check FAILED (AD-56):");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log(`check-attendance-readers: OK (${found.size} allowlisted base-table reader file(s), no new reader of attendance_events)`);
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) main(process.argv.slice(2));
