#!/usr/bin/env node
// Story 1.10 AC #2: "Given the EN and FR locale files, When either file is
// missing a key present in the other, Then CI fails with a key-parity
// error." Plain Node, zero dependencies -- walks every locales/{en,fr}.json
// pair in the repo and diffs their flattened key sets.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const LOCALE_DIRS = [
  "packages/types/src/locales",
  "apps/dashboard/locales",
  "apps/super-admin/locales",
];

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

let hasFailure = false;

for (const dir of LOCALE_DIRS) {
  const enPath = join(repoRoot, dir, "en.json");
  const frPath = join(repoRoot, dir, "fr.json");

  const enKeys = new Set(flattenKeys(loadJson(enPath)));
  const frKeys = new Set(flattenKeys(loadJson(frPath)));

  const missingInFr = [...enKeys].filter((k) => !frKeys.has(k));
  const missingInEn = [...frKeys].filter((k) => !enKeys.has(k));

  if (missingInFr.length > 0 || missingInEn.length > 0) {
    hasFailure = true;
    console.error(`\nKey-parity mismatch in ${dir}:`);
    if (missingInFr.length > 0) {
      console.error(`  Present in en.json, missing from fr.json:`);
      for (const key of missingInFr) console.error(`    - ${key}`);
    }
    if (missingInEn.length > 0) {
      console.error(`  Present in fr.json, missing from en.json:`);
      for (const key of missingInEn) console.error(`    - ${key}`);
    }
  } else {
    console.log(`OK ${dir}: ${enKeys.size} keys, en/fr in parity`);
  }
}

if (hasFailure) {
  console.error("\ni18n key-parity check failed.");
  process.exit(1);
}

console.log("\ni18n key-parity check passed.");
