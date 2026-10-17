/**
 * Story 22 retro item 53: every exported Server Action in the Super Admin app goes through the gate
 * (authorizePlatformAction, or authorizeOrRedirect which wraps it): live role, aal2 while the flag is on,
 * session limits, lock. A new "use server" export that skips the gate fails here.
 *
 * The scan is syntactic (TypeScript AST). It recognises function declarations and `export const x = async () => {}`
 * style exports, and it FAILS on any export it cannot classify (`export { x }`, `export * from`, `export default`)
 * so a new shape cannot slip past silently. A gate call counts only as a real call expression, never as text in a
 * comment or string, and a local helper counts only when its own body calls the gate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = join(__dirname, "..");
const GATES = new Set(["authorizePlatformAction", "authorizeOrRedirect"]);

/** Pre-session flows that cannot hold an authorized session by design. Reason required. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "app/auth/mfa/enroll/actions.ts": "first authenticator after a recovery reset: aal1 session, window checked in the database (recovery_enrol_allowed)",
  "app/auth/mfa/recovery-actions.ts": "sign-in prompt recovery: password (aal1) session by definition; verified user, no capability yet",
  "app/auth/recovery/cancel/actions.ts": "cancel link from an email: the 256-bit token is the credential",
};

interface ExportInfo {
  name: string;
  gated: boolean;
}
interface Analysis {
  useServer: boolean;
  exports: ExportInfo[];
  unclassified: string[];
}

function callsGate(node: ts.Node | undefined, helpers: Set<string>): boolean {
  if (!node) return false;
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const callee = n.expression.text;
      if (GATES.has(callee) || helpers.has(callee)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

export function analyse(source: string, fileName = "x.ts"): Analysis {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const first = sf.statements[0];
  const useServer =
    !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";

  // Local helpers (any top-level function or const function) whose own body calls the gate, to a fixed point.
  const bodies = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) bodies.set(st.name.text, st.body);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          bodies.set(d.name.text, d.initializer.body);
        }
      }
    }
  }
  const helpers = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (!helpers.has(name) && callsGate(body, helpers)) {
        helpers.add(name);
        changed = true;
      }
    }
  }

  const exports: ExportInfo[] = [];
  const unclassified: string[] = [];
  const isExported = (n: ts.Node) => !!ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st)) {
      if (ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) unclassified.push("export default function");
      else exports.push({ name: st.name?.text ?? "(anonymous)", gated: callsGate(st.body, helpers) });
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : "(destructured)";
        const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer : null;
        if (!fn) unclassified.push(`export const ${name} (not a function expression)`);
        else exports.push({ name, gated: callsGate(fn.body, helpers) });
      }
    } else if (ts.isExportDeclaration(st)) {
      if (!st.isTypeOnly) unclassified.push(st.moduleSpecifier ? "export ... from" : "export { ... }");
    } else if (ts.isExportAssignment(st)) {
      unclassified.push("export default <expression>");
    }
    // type/interface/enum exports are not callable actions.
  }
  return { useServer, exports, unclassified };
}

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
  return [join(ROOT, "app"), join(ROOT, "lib"), join(ROOT, "components"), join(ROOT, "services")]
    .flatMap((d) => walk(d))
    .filter((f) => analyse(readFileSync(f, "utf8"), f).useServer);
}

describe("analyse (the scanner itself)", () => {
  const gated = `"use server";\nimport { authorizeOrRedirect } from "@/lib/authz-action";\nexport async function ok() { const a = await authorizeOrRedirect("x"); if (!a.ok) return; }`;

  it("accepts a function that calls the gate", () => {
    const a = analyse(gated);
    expect(a.useServer).toBe(true);
    expect(a.exports).toEqual([{ name: "ok", gated: true }]);
    expect(a.unclassified).toEqual([]);
  });
  it("sees a directive that follows a comment", () => {
    expect(analyse(`// header\n/* more */\n"use server";\nexport async function f() {}`).useServer).toBe(true);
  });
  it("flags an ungated function declaration", () => {
    expect(analyse(`"use server";\nexport async function f() { return 1; }`).exports).toEqual([{ name: "f", gated: false }]);
  });
  it("flags an ungated arrow-function export (the shape the old scan missed)", () => {
    expect(analyse(`"use server";\nexport const wipe = async (id: string) => { await db(id); };`).exports).toEqual([{ name: "wipe", gated: false }]);
  });
  it("accepts a gated arrow-function export", () => {
    expect(analyse(`"use server";\nexport const f = async () => { await authorizePlatformAction("x"); };`).exports).toEqual([{ name: "f", gated: true }]);
  });
  it("does not count the gate's name in a comment or a string", () => {
    const a = analyse(`"use server";\nexport async function f() { // authorizePlatformAction(\n const s = "authorizePlatformAction("; return s; }`);
    expect(a.exports).toEqual([{ name: "f", gated: false }]);
  });
  it("counts a local helper only when the helper really calls the gate", () => {
    const withGate = analyse(`"use server";\nasync function guard() { return authorizeOrRedirect("x"); }\nexport async function f() { await guard(); }`);
    expect(withGate.exports).toEqual([{ name: "f", gated: true }]);
    const withoutGate = analyse(`"use server";\nasync function guard() { return 1; }\nexport async function f() { await guard(); }`);
    expect(withoutGate.exports).toEqual([{ name: "f", gated: false }]);
  });
  it("does not mistake a short helper name for a substring of other calls", () => {
    const a = analyse(`"use server";\nasync function a() { return authorizeOrRedirect("x"); }\nexport async function f() { return forget(); }`);
    expect(a.exports).toEqual([{ name: "f", gated: false }]);
  });
  it("fails closed on export shapes it cannot classify", () => {
    expect(analyse(`"use server";\nasync function f() {}\nexport { f };`).unclassified).toEqual(["export { ... }"]);
    expect(analyse(`"use server";\nexport * from "./x";`).unclassified).toEqual(["export ... from"]);
    expect(analyse(`"use server";\nexport default async function () {}`).unclassified).toEqual(["export default function"]);
    expect(analyse(`"use server";\nexport const x = 5;`).unclassified).toEqual(["export const x (not a function expression)"]);
  });
  it("ignores type-only exports", () => {
    expect(analyse(`"use server";\nexport interface A {}\nexport type B = string;\nexport type { C } from "./c";`).unclassified).toEqual([]);
  });
});

describe("Super Admin Server Actions are all gated", () => {
  const files = useServerFiles();

  it("finds the use-server modules (guards against the scan silently matching nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    if (PUBLIC_BY_DESIGN[rel]) continue;
    const analysis = analyse(readFileSync(file, "utf8"), file);
    it(`${rel}: has no export shape the scan cannot check`, () => {
      expect(analysis.unclassified, `${rel} uses an export form the gate scan cannot classify`).toEqual([]);
    });
    for (const fn of analysis.exports) {
      it(`${rel}: ${fn.name} calls the gate`, () => {
        expect(fn.gated, `${fn.name} in ${rel} must call authorizePlatformAction or authorizeOrRedirect (or a local helper that does)`).toBe(true);
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
