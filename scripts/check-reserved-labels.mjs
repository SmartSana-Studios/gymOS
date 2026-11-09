#!/usr/bin/env node
// Story 24.2 (AD-43/AD-45): a gym must not be able to claim a name that is a real label in the gymosapps.com zone. This gate reads
// the committed zone export (docs/dns/gymosapps.com.zone) and the one reserved list (packages/types/src/constants/reservedLabels.json,
// which the TS module in the same folder re-exports) and fails when:
//   - a label directly under the apex that passes the AD-45 name grammar is neither in the list nor under a reserved prefix;
//   - the list has an uppercase, duplicate or grammar-invalid entry;
//   - either file is missing, or a zone line cannot be parsed.
// Labels that fail the grammar (underscore labels, _tcp, _domainkey) can never be claimed; they are ignored and counted.
// Plain Node, zero dependencies. Exit 1 with one line per violation.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const ZONE_PATH = "docs/dns/gymosapps.com.zone";
export const LIST_PATH = "packages/types/src/constants/reservedLabels.json";
const DEFAULT_APEX = "gymosapps.com";
const RR_TYPES = new Set(["A", "AAAA", "CAA", "CNAME", "DNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"]);

// AD-45 name grammar: ONE definition, packages/types/src/constants/pageNameGrammar.ts (Story 24.10; before that this file held a copy).
// It is a TypeScript file with no imports, loaded by Node's own type stripping (Node 22.18 or later; CI uses the latest 22). The two
// warnings Node prints for a typeless package ("Reparsing as ES module", type stripping) are muted around that one load.
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`check-reserved-labels needs Node 22.18 or later (it loads a TypeScript file through Node's type stripping); this is Node ${process.versions.node}.`);
    process.exit(1);
  }
}
export const GRAMMAR_PATH = "packages/types/src/constants/pageNameGrammar.ts";
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (/Reparsing as ES module|Type Stripping/i.test(String(warning)) ? undefined : emitWarning.call(process, warning, ...rest));
let grammar;
try {
  grammar = await import(pathToFileURL(join(repoRoot, GRAMMAR_PATH)).href);
} finally {
  process.emitWarning = emitWarning;
}
/** AD-45 name grammar: 3 to 30 chars, a-z0-9-, no leading/trailing hyphen, no `--` (so no `xn--`), not digits only. */
export const isValidName = grammar.isValidPageName;

/** Remove a `;` comment, ignoring semicolons inside double quotes. */
function stripComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && inQuote) i++;
    else if (c === '"') inQuote = !inQuote;
    else if (c === ";" && !inQuote) return line.slice(0, i);
  }
  return line;
}

/** Tokens of the part of a line before any quoted string or parenthesis; enough to find owner, TTL, class and type. */
function headTokens(line) {
  const cut = line.search(/["(]/);
  return (cut === -1 ? line : line.slice(0, cut)).trim().split(/\s+/).filter(Boolean);
}

/** The label directly under the apex for an owner name, or null for the apex itself. */
export function labelUnderApex(owner, origin) {
  if (owner === "@") return null;
  let rel = owner;
  if (owner.endsWith(".")) {
    const full = owner.slice(0, -1).toLowerCase();
    if (full === origin) return null;
    if (!full.endsWith("." + origin)) return undefined; // outside the zone
    rel = full.slice(0, -origin.length - 1);
  } else if (owner.toLowerCase() === origin) {
    return undefined;
  }
  const parts = rel.toLowerCase().split(".");
  return parts[parts.length - 1];
}

/**
 * Parse a zone file into [{ line, label }] (label null = apex) for every record, plus errors for unparseable lines.
 * Blank owner inherits the previous one; `$ORIGIN` changes the apex; other `$` directives are skipped.
 */
export function parseZone(text) {
  const records = [];
  const errors = [];
  let origin = DEFAULT_APEX;
  let previous; // undefined until an owner has been seen
  let depth = 0; // inside a multi-line parenthesised record
  text.split(/\r?\n/).forEach((raw, idx) => {
    const n = idx + 1;
    const line = stripComment(raw);
    const parenDelta = (line.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/\(/g) ?? []).length - (line.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/\)/g) ?? []).length;
    if (depth > 0) {
      depth += parenDelta;
      return;
    }
    if (line.trim() === "") return;
    if (line.trim().startsWith("$")) {
      const [dir, arg] = line.trim().split(/\s+/);
      if (dir.toUpperCase() === "$ORIGIN") {
        if (!arg) errors.push(`${ZONE_PATH}:${n}: $ORIGIN without a name`);
        else origin = arg.replace(/\.$/, "").toLowerCase();
      }
      return;
    }
    const tokens = headTokens(line);
    const inherits = /^\s/.test(line);
    const owner = inherits ? previous : tokens.shift();
    if (owner === undefined) {
      errors.push(`${ZONE_PATH}:${n}: record with no owner and no previous owner: ${raw.trim()}`);
      return;
    }
    // After the owner: optional TTL (digits) and class (IN), then the type.
    while (tokens.length > 0 && (/^\d+[smhdw]?$/i.test(tokens[0]) || /^(IN|CH|HS)$/i.test(tokens[0]))) tokens.shift();
    if (tokens.length === 0 || !RR_TYPES.has(tokens[0].toUpperCase())) {
      errors.push(`${ZONE_PATH}:${n}: cannot parse record (no known type): ${raw.trim()}`);
      return;
    }
    const label = labelUnderApex(owner, origin);
    if (label === undefined) {
      errors.push(`${ZONE_PATH}:${n}: owner ${owner} is outside ${origin}`);
      return;
    }
    previous = owner;
    depth += parenDelta;
    records.push({ line: n, label });
  });
  return { records, errors };
}

/** Problems with the list itself: shape, uppercase, duplicate, grammar-invalid entries. */
export function validateList(list) {
  const problems = [];
  if (!list || !Array.isArray(list.labels) || !Array.isArray(list.prefixes)) {
    return [`${LIST_PATH}: must be { "labels": [...], "prefixes": [...] }`];
  }
  const seen = new Set();
  for (const l of list.labels) {
    if (typeof l !== "string") problems.push(`${LIST_PATH}: non-string label ${JSON.stringify(l)}`);
    else if (l !== l.toLowerCase()) problems.push(`${LIST_PATH}: label "${l}" is not lowercase`);
    else if (!isValidName(l)) problems.push(`${LIST_PATH}: label "${l}" fails the name grammar (it could never be claimed anyway)`);
    else if (seen.has(l)) problems.push(`${LIST_PATH}: label "${l}" is listed twice`);
    else seen.add(l);
  }
  const seenPrefix = new Set();
  for (const p of list.prefixes) {
    if (typeof p !== "string" || !/^[a-z0-9-]+$/.test(p)) problems.push(`${LIST_PATH}: prefix ${JSON.stringify(p)} must be lowercase a-z0-9-`);
    else if (seenPrefix.has(p)) problems.push(`${LIST_PATH}: prefix "${p}" is listed twice`);
    else seenPrefix.add(p);
  }
  return problems;
}

export function isReserved(label, list) {
  return list.labels.includes(label) || list.prefixes.some((p) => label.startsWith(p));
}

/** { problems, checked, ignored } for a zone text and a parsed list. */
export function checkZone(zoneText, list) {
  const problems = validateList(list);
  const { records, errors } = parseZone(zoneText);
  problems.push(...errors);
  const checked = new Set();
  let ignored = 0;
  if (Array.isArray(list?.labels) && Array.isArray(list?.prefixes)) {
    const reportedLabels = new Set();
    for (const { line, label } of records) {
      if (label === null) continue; // the apex itself
      if (!isValidName(label)) {
        ignored++;
        continue;
      }
      checked.add(label);
      if (!isReserved(label, list) && !reportedLabels.has(label)) {
        reportedLabels.add(label);
        problems.push(`${ZONE_PATH}:${line}: label "${label}" is in the zone but not reserved; add it to ${LIST_PATH} or a gym could claim it`);
      }
    }
  }
  return { problems, checked: [...checked].sort(), ignored };
}

export function checkRepo(root = repoRoot) {
  const zonePath = join(root, ZONE_PATH);
  const listPath = join(root, LIST_PATH);
  const missing = [zonePath, listPath].filter((p) => !existsSync(p)).map((p) => `missing file: ${p}`);
  if (missing.length > 0) return { problems: missing, checked: [], ignored: 0 };
  let list;
  try {
    list = JSON.parse(readFileSync(listPath, "utf8"));
  } catch (e) {
    return { problems: [`${LIST_PATH}: not valid JSON (${e.message})`], checked: [], ignored: 0 };
  }
  return checkZone(readFileSync(zonePath, "utf8"), list);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { problems, checked, ignored } = checkRepo();
  if (problems.length > 0) {
    console.error("reserved-label check FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`reserved-label check OK: ${checked.length} zone labels checked (${checked.join(", ")}), ${ignored} ignored (fail the name grammar).`);
}
