import { readFileSync } from "node:fs";

import { FIXTURES_FILE_PATH, type FixtureData } from "../fixtures/types";

/** Reads globalSetup's output -- the one channel Playwright provides
 * between `globalSetup` (a separate process) and each spec's workers. */
export function loadFixtures(): FixtureData {
  return JSON.parse(readFileSync(FIXTURES_FILE_PATH, "utf-8"));
}
