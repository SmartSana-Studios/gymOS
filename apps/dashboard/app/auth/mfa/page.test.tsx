import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectCalls: string[] = [];
function redirect(to: string): never {
  redirectCalls.push(to);
  throw new Error(`REDIRECT:${to}`);
}
let assurance: { data: unknown; error: unknown };
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => assurance },
    },
  }),
}));
vi.mock("@/components/mfa-form", () => ({ MfaForm: () => null }));

import Page from "./page";

async function run() {
  const element = Page({ searchParams: Promise.resolve({}) });
  // Page returns <Suspense><MfaStep/></Suspense>; render the inner async component directly.
  const step = (element as { props: { children: { type: (p: unknown) => Promise<unknown>; props: unknown } } }).props.children;
  return step.type(step.props);
}

beforeEach(() => {
  redirectCalls.length = 0;
});

describe("/auth/mfa page", () => {
  it("fails closed to /auth/login when the assurance level cannot be read", async () => {
    assurance = { data: null, error: { message: "boom" } };
    await expect(run()).rejects.toThrow("REDIRECT:/auth/login");
  });

  it("shows the code step when a second factor is owed", async () => {
    assurance = { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null };
    await expect(run()).resolves.toBeTruthy();
    expect(redirectCalls).toEqual([]);
  });
});
