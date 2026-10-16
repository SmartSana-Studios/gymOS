import { randomBytes, randomInt } from "node:crypto";

/** Story 22.8 helpers. Server-only. */

/** 6 digits from the OS CSPRNG (never Math.random). */
export function generateRecoveryCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 256-bit token for the cancel links; only its SHA-256 is stored in the database. */
export function generateCancelToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Origin used in the cancel links of recovery emails. Taken from configuration, never from the request:
 * a forged Host header must not be able to point a victim's cancel link somewhere else. Returns null in
 * production when SUPER_ADMIN_APP_URL is missing (the caller then refuses to start a recovery).
 */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.SUPER_ADMIN_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

export function cancelUrl(base: string, token: string): string {
  return `${base}/auth/recovery/cancel?token=${encodeURIComponent(token)}`;
}
