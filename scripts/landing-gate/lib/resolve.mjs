// Resolves the kit's two third-party modules from the workspace package that already depends on them, so the kit adds no dependency of its own
// (Story 24.12): `pg` from apps/landing, Playwright from apps/dashboard, `sharp` from apps/dashboard.
import { createRequire } from "node:module";

const root = new URL("../../../", import.meta.url);
const from = (pkgJson) => createRequire(new URL(pkgJson, root));

export const loadPg = () => from("apps/landing/package.json")("pg");
export const loadPlaywright = () => from("apps/dashboard/package.json")("@playwright/test");
export const loadSharp = () => from("apps/dashboard/package.json")("sharp");
export const REPO_ROOT = root;
