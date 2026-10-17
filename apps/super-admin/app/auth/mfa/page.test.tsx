import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string } | null = null;
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } })),
}));
let enrolAllowed = false;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: vi.fn(async () => ({ data: enrolAllowed, error: null })) })),
}));
vi.mock("@/components/mfa-form", () => ({ MfaForm: () => null }));

import Page from "./page";

beforeEach(() => {
  user = null;
  enrolAllowed = false;
});

describe("/auth/mfa", () => {
  it("without a session redirects to /auth/login", async () => {
    await expect(Page()).rejects.toThrow("REDIRECT:/auth/login");
  });
  it("sends an account whose recovery reset just applied to the first-authenticator page", async () => {
    user = { id: "sa-1" };
    enrolAllowed = true;
    await expect(Page()).rejects.toThrow("REDIRECT:/auth/mfa/enroll");
  });
  it("with a session renders the prompt", async () => {
    user = { id: "sa-1" };
    await expect(Page()).resolves.toBeTruthy();
  });
});
