/** Story 24-3: the dashboard and super-admin session cookie options must not drift (AD-44). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("cookie-options.ts is identical in apps/dashboard and apps/super-admin", () => {
  const read = (app: string) => readFileSync(resolve(__dirname, `../../../${app}/lib/supabase/cookie-options.ts`), "utf8");
  expect(read("super-admin")).toBe(read("dashboard"));
});
