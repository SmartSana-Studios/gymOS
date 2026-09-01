import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { supabaseAnonKey, supabaseUrl } from "./env";
import { FIXTURE_PASSWORD } from "../fixtures/types";

/** Drives the real, unmodified login form (components/login-form.tsx) --
 * proves the real UI/session path, per this story's own Flow 1 design. */
export async function loginViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/auth/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: /sign in|connexion/i }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
}

interface ApiSession {
  accessToken: string;
}

/**
 * A real GoTrue password-grant sign-in via `APIRequestContext` -- the same
 * HTTP boundary `supabase-js`'s own `signInWithPassword` calls under the
 * hood, just driven directly. Used for the Supervisor/Manager
 * `APIRequestContext`-level assertions (AC #3), which must prove
 * server-side enforcement independent of the dashboard's own UI/session
 * plumbing.
 */
export async function signInForApi(
  request: APIRequestContext,
  identifier: { email: string } | { phone: string },
): Promise<ApiSession> {
  const response = await request.post(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    headers: { apikey: supabaseAnonKey(), "Content-Type": "application/json" },
    data: { ...identifier, password: FIXTURE_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`e2e: password-grant sign-in failed (${response.status()}) -- ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string };
  return { accessToken: body.access_token };
}

/** POSTs to PostgREST's RPC endpoint under a real caller session -- the
 * exact request shape `supabase-js`'s own `.rpc()` sends, driven directly
 * so a rejection's real HTTP status/body is inspectable (Subtask 4.3). */
export async function callRpc(
  request: APIRequestContext,
  session: ApiSession,
  functionName: string,
  args: Record<string, unknown>,
) {
  return request.post(`${supabaseUrl()}/rest/v1/rpc/${functionName}`, {
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    data: args,
  });
}
