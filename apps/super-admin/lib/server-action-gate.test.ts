/**
 * Story 22 retro item 53: every exported Server Action in the Super Admin app goes through
 * authorizePlatformAction (live role, aal2 while the flag is on, session limits, lock). A new
 * "use server" export that skips the gate fails here, so the gate cannot be forgotten again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = join(__dirname, "..");

/** Pre-session flows that cannot hold an authorized session by design. Reason required. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "app/auth/mfa/enroll/actions.ts": "first authenticator after a recovery reset: aal1 session, window checked in the database (recovery_enrol_allowed)",
  "app/auth/mfa/recovery-actions.ts": "sign-in prompt recovery: password (aal1) session by definition; verified user, no capability yet",
  "app/auth/recovery/cancel/actions.ts": "cancel link from an email: the 256-bit token is the credential",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function useServerFiles(): string[] {
  return walk(join(ROOT, "app")).filter((f) => /^\s*(["'])use server\1/.test(readFileSync(f, "utf8").trimStart()));
}

/** Exported async functions of a file with their body text, plus local helpers that call the gate. */
function analyse(file: string) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const fns: { name: string; exported: boolean; text: string }[] = [];
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const exported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      fns.push({ name: node.name.text, exported, text: node.body.getText(sf) });
    }
  });
  const gates = new Set(fns.filter((f) => f.text.includes("authorizePlatformAction(")).map((f) => f.name));
  return { fns, gates };
}

describe("Super Admin Server Actions are all gated", () => {
  const files = useServerFiles();

  it("finds the use-server modules (guards against the scan silently matching nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    if (PUBLIC_BY_DESIGN[rel]) continue;
    const { fns, gates } = analyse(file);
    for (const fn of fns.filter((f) => f.exported)) {
      it(`${rel}: ${fn.name} calls the gate`, () => {
        const callsGate = fn.text.includes("authorizePlatformAction(") || [...gates].some((g) => fn.text.includes(`${g}(`));
        expect(callsGate, `${fn.name} in ${rel} must call authorizePlatformAction (or a local helper that does)`).toBe(true);
      });
    }
  }

  it("every public-by-design exemption still exists and names a reason", () => {
    for (const [rel, reason] of Object.entries(PUBLIC_BY_DESIGN)) {
      expect(files.map((f) => relative(ROOT, f))).toContain(rel);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
