/**
 * Story 22.5: records the provider's first-factor window and asserts the AAL1 refusal.
 * Needs the local stack (`supabase start`) with [auth.mfa.totp] enabled; skipped otherwise.
 * Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run it.
 *
 * Recorded behavior (Story 22.1 spike, re-asserted here):
 *  - a password session with NO verified factor can enroll and verify a first factor at aal1
 *    (the first-factor window; guarded only by the Server Action path, no trigger on auth.mfa_factors);
 *  - once a verified factor exists, POST /auth/v1/factors from an aal1 session is refused 403
 *    insufficient_aal.
 */
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && ANON && SERVICE);

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

async function api(path: string, init: RequestInit & { token?: string; service?: boolean } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: init.service ? SERVICE! : ANON!,
      Authorization: `Bearer ${init.token ?? (init.service ? SERVICE : ANON)}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signIn(email: string, password: string): Promise<string> {
  const r = await api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  return r.body.access_token as string;
}

describe.skipIf(!enabled)("direct provider factor enrollment", () => {
  it("first factor enrolls at aal1; a second from an aal1 session is 403 insufficient_aal", async () => {
    const email = `mfa-${randomUUID()}@example.test`;
    const password = `Pw-${randomUUID()}`;
    const created = await api("/auth/v1/admin/users", {
      method: "POST",
      service: true,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    expect(created.status).toBe(200);
    try {
      let token = await signIn(email, password);

      // First-factor window: allowed at aal1.
      const first = await api("/auth/v1/factors", {
        method: "POST",
        token,
        body: JSON.stringify({ factor_type: "totp", friendly_name: "first" }),
      });
      expect(first.status).toBe(200);
      const challenge = await api(`/auth/v1/factors/${first.body.id}/challenge`, { method: "POST", token, body: "{}" });
      expect(challenge.status).toBe(200);
      const verify = await api(`/auth/v1/factors/${first.body.id}/verify`, {
        method: "POST",
        token,
        body: JSON.stringify({ challenge_id: challenge.body.id, code: totp(first.body.totp.secret) }),
      });
      expect(verify.status).toBe(200);

      // Fresh password session: aal1 with a verified factor present.
      token = await signIn(email, password);
      const second = await api("/auth/v1/factors", {
        method: "POST",
        token,
        body: JSON.stringify({ factor_type: "totp", friendly_name: "second" }),
      });
      expect(second.status).toBe(403);
      expect(second.body.error_code).toBe("insufficient_aal");
    } finally {
      await api(`/auth/v1/admin/users/${created.body.id}`, { method: "DELETE", service: true });
    }
  });
});
