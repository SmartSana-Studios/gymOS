/**
 * Epic 22 retro item 60: the platform capabilities the app can ask for (the PlatformCapability type in authz.ts)
 * must be exactly the platform.* capabilities the database knows (private.capability_roles). An app capability the
 * database does not know is denied in production as `unknown_capability` with nothing failing in a test; a database
 * capability the app type lacks is dead code. The pgTAP file supabase/tests/authorize_action_platform.test.sql pins the
 * database side; this pins the pair.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");

function appCapabilities(): string[] {
  const src = readFileSync(join(__dirname, "authz.ts"), "utf8");
  const type = /export type PlatformCapability =([^;]+);/.exec(src);
  if (!type) throw new Error("PlatformCapability type not found in lib/authz.ts");
  return [...type[1].matchAll(/"(platform\.[a-z_]+)"/g)].map((m) => m[1]).sort();
}

/** The platform.* capabilities in the LATEST migration that (re)defines private.capability_roles. */
function databaseCapabilities(): string[] {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => /function\s+private\.capability_roles\s*\(/i.test(readFileSync(join(dir, f), "utf8")));
  if (defining.length === 0) throw new Error("no migration defines private.capability_roles");
  const sql = readFileSync(join(dir, defining[defining.length - 1]), "utf8");
  const body = /function\s+private\.capability_roles[\s\S]*?\$\$;/i.exec(sql)?.[0] ?? "";
  return [...body.matchAll(/'(platform\.[a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("platform capabilities: app type and database agree", () => {
  it("finds both lists (guards against the scan silently matching nothing)", () => {
    expect(appCapabilities().length).toBeGreaterThanOrEqual(4);
    expect(databaseCapabilities().length).toBeGreaterThanOrEqual(4);
  });

  it("every capability the app can ask for exists in the database", () => {
    const db = new Set(databaseCapabilities());
    expect(appCapabilities().filter((c) => !db.has(c))).toEqual([]);
  });

  it("every platform capability in the database is typed in the app", () => {
    const app = new Set(appCapabilities());
    expect(databaseCapabilities().filter((c) => !app.has(c))).toEqual([]);
  });
});
