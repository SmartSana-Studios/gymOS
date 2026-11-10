import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";
import { FIXTURE_PASSWORD } from "../fixtures/types";

// Story 24.12: helpers of e2e/landing-page-gate.spec.ts. Everything here is local-database and local-server only.
//
//   * a dedicated gym per run and language (own Owner, own plan), so the flows never touch the shared fixture gym and a French run starts
//     from the same state as an English one (a name can be renamed twice in 12 months, so one gym cannot serve both)
//   * the content that passes the publish gate, written through the real RPCs the editor uses (`set_gym_page_content`, `register_page_media`);
//     the Owner then claims the name and publishes through the UI
//   * a Super Admin created by service role for the takedown RPC (the aal2 flag is asserted off, so `is_super_admin_live()` needs no factor)
//   * Host-header requests to the landing server (second Playwright webServer; no DNS: the label goes in the Host header)

export const LANDING_PORT = Number(process.env.E2E_LANDING_PORT ?? 3200); // the same variable playwright.config.ts starts the landing server on
export const LANDING_ORIGIN = `http://127.0.0.1:${LANDING_PORT}`;
export const ROOT_DOMAIN = "localhost";

export type Lang = "en" | "fr";

/** The dashboard's own locale files, read from disk: the spec asserts the words the app really shows. */
export interface PageEditorLocale {
  title: string;
  name: { claim: string; claimButton: string; change: string; rename: string };
  header: { unpublish: string };
  publish: { title: string; button: string };
  unpublish: { confirm: string; toast: string };
}

export function locale(lang: Lang): { pageEditor: PageEditorLocale } {
  // resolved from this file (apps/dashboard/e2e/helpers), not from the working directory
  return JSON.parse(readFileSync(path.join(__dirname, "..", "..", "locales", `${lang}.json`), "utf-8"));
}

function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`landing gate e2e: sign-in as ${email} failed -- ${error.message}`);
  return client;
}

export interface PageGym {
  lang: Lang;
  gymId: string;
  planId: string;
  ownerEmail: string;
  ownerUserId: string;
  ownerMemberId: string;
  gymName: string;
  /** A name no other run uses (names are unique across the platform and a rename leaves the old one reserved). */
  names: { first: string; second: string };
  aboutEn: string;
  aboutFr: string;
}

function unique(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`;
}

/** Creates the gym, its Owner (email login, password known, preferred language set), one plan and the gate content. Nothing is claimed or published. */
export async function createPageGym(lang: Lang): Promise<PageGym> {
  const admin = adminClient();
  const tag = unique();
  const { data: tier, error: tierError } = await admin.from("tiers").select("id").order("created_at").limit(1).single();
  if (tierError || !tier) throw new Error(`landing gate e2e: no tier -- ${tierError?.message}`);
  // "E2E Fixture Gym" prefix: ci-local's preflight reports a leftover of an aborted run by this name
  const gymName = `E2E Fixture Gym Page ${lang.toUpperCase()} ${tag}`;
  const { data: gym, error: gymError } = await admin.from("gyms").insert({ name: gymName, tier_id: tier.id, status: "active" }).select("id").single();
  if (gymError || !gym) throw new Error(`landing gate e2e: gym insert -- ${gymError?.message}`);

  const ownerEmail = `e2e-page-owner-${lang}-${tag}@fixture.gymos.test`;
  const phone = `+23769${Math.floor(Math.random() * 10 ** 7).toString().padStart(7, "0")}`; // random: two runs in the same millisecond window cannot clash
  let ownerUserId: string | undefined;
  try {
  const { data: created, error: userError } = await admin.auth.admin.createUser({ email: ownerEmail, phone, password: FIXTURE_PASSWORD, email_confirm: true, phone_confirm: true });
  if (userError || !created.user) throw new Error(`landing gate e2e: owner user -- ${userError?.message}`);
  ownerUserId = created.user.id;
  const { data: member, error: memberError } = await admin
    .from("members")
    .insert({ gym_id: gym.id, user_id: created.user.id, role: "owner", name: "E2E Page Owner", phone })
    .select("id")
    .single();
  if (memberError || !member) throw new Error(`landing gate e2e: owner member -- ${memberError?.message}`);
  const { error: userUpdateError } = await admin.from("users").update({ must_change_password: false, preferred_language: lang }).eq("id", created.user.id);
  if (userUpdateError) throw new Error(`landing gate e2e: owner language -- ${userUpdateError.message}`);

  const { data: plan, error: planError } = await admin
    .from("plans")
    .insert({ gym_id: gym.id, name: "Page Monthly", plan_type: "monthly", price: 15000, currency: "XAF", billing_interval: "monthly", duration_days: 30 })
    .select("id")
    .single();
  if (planError || !plan) throw new Error(`landing gate e2e: plan -- ${planError?.message}`);

  const aboutEn = `${gymName} is a friendly neighbourhood gym with coaches on every shift, clean changing rooms and classes for every level.`;
  const aboutFr = `${gymName} est une salle de quartier conviviale avec des coachs a chaque service, des vestiaires propres et des cours pour tous les niveaux.`;
  const pg: PageGym = {
    lang,
    gymId: gym.id as string,
    planId: plan.id as string,
    ownerEmail,
    ownerUserId: created.user.id,
    ownerMemberId: member.id as string,
    gymName,
    names: { first: `e2e-${lang}-${tag}`, second: `e2e-${lang}-${tag}-b` },
    aboutEn,
    aboutFr,
  };
  await fillGate(pg);
  return pg;
  } catch (e) {
    // the caller never gets a handle on a failed create, so nothing else would remove the gym and the auth user
    await removeGymRows(gym.id as string, ownerUserId);
    throw e;
  }
}

/** The nine publish-gate items except the name: text in both languages, country and city, a public contact, hours, one public plan, logo and banner. */
async function fillGate(pg: PageGym): Promise<void> {
  const owner = await signedInClient(pg.ownerEmail);
  const { error } = await owner.rpc("set_gym_page_content", {
    p_gym_id: pg.gymId,
    p_content: {
      about_en: pg.aboutEn,
      about_fr: pg.aboutFr,
      city: "Douala",
      contact_phone: "+237600555000",
      hours: { mon: { open: "06:00", close: "22:00" }, sun: null },
    },
    p_plans: [{ plan_id: pg.planId, is_public: true }],
  });
  if (error) throw new Error(`landing gate e2e: set_gym_page_content -- ${error.message}`);
  // media rows need no Storage objects: the gate counts registered, attested rows
  for (const [n, kind] of [[1, "logo"], [2, "banner"]] as const) {
    const key = `${pg.gymId}/aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
    const derivative = `bbbbbbbb-bbbb-bbbb-bbbb-${pg.gymId.slice(-8)}${String(n).padStart(4, "0")}.webp`;
    const { error: mediaError } = await owner.rpc("register_page_media", {
      p_gym_id: pg.gymId,
      p_kind: kind,
      p_original_key: key,
      p_derivative_key: derivative,
      p_attested: true,
      p_attestation_version: "v1",
    });
    if (mediaError) throw new Error(`landing gate e2e: register_page_media(${kind}) -- ${mediaError.message}`);
  }
}

/** Removes everything a page gym made, in FK-safe order. `notifications` has no cascade; the page tables cascade from the gym. */
export async function removePageGym(pg: PageGym): Promise<void> {
  await removeGymRows(pg.gymId, pg.ownerUserId);
}

async function removeGymRows(gymId: string, ownerUserId: string | undefined): Promise<void> {
  const admin = adminClient();
  const tryDelete = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) console.error(`landing gate e2e cleanup: ${label} failed -- ${error.message}`);
  };
  await tryDelete("notifications", admin.from("notifications").delete().eq("gym_id", gymId));
  await tryDelete("members", admin.from("members").delete().eq("gym_id", gymId));
  await tryDelete("plans", admin.from("plans").delete().eq("gym_id", gymId));
  await tryDelete("gym", admin.from("gyms").delete().eq("id", gymId));
  if (ownerUserId) {
    try {
      await admin.auth.admin.deleteUser(ownerUserId);
    } catch (e) {
      console.error("landing gate e2e cleanup: owner user delete failed --", e);
    }
  }
}

export interface SuperAdmin {
  userId: string;
  email: string;
  client: SupabaseClient;
}

/**
 * A Super Admin for the takedown RPC. Created by service role (`users.is_super_admin = true`), signed in by password. `is_super_admin_live()` reads the
 * flag live and needs aal2 only while the platform flag `super_admin_aal2` is ON, so the spec asserts it is OFF (it ships off; the test database must
 * not be in the bootstrap-complete state or this suite cannot run).
 */
export async function createSuperAdmin(): Promise<SuperAdmin> {
  const admin = adminClient();
  const email = `e2e-page-admin-${unique()}@fixture.gymos.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIXTURE_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`landing gate e2e: super admin user -- ${error?.message}`);
  const { error: flagError } = await admin.from("users").update({ is_super_admin: true, must_change_password: false }).eq("id", data.user.id);
  if (flagError) throw new Error(`landing gate e2e: is_super_admin -- ${flagError.message}`);
  return { userId: data.user.id, email, client: await signedInClient(email) };
}

export async function removeSuperAdmin(sa: SuperAdmin): Promise<void> {
  const admin = adminClient();
  try {
    await admin.auth.admin.deleteUser(sa.userId);
  } catch (e) {
    console.error("landing gate e2e cleanup: super admin delete failed --", e);
  }
}

/** The platform flag `super_admin_aal2` as the service path reads it. */
export async function aal2Required(): Promise<boolean> {
  // the reader is granted to service_role alone (migration 0126)
  const { data, error } = await adminClient().rpc("super_admin_aal2_required");
  if (error) throw new Error(`landing gate e2e: super_admin_aal2_required -- ${error.message}`);
  return data === true;
}

export interface LandingResponse {
  status: number;
  /** Folded, one string per header (repeated values joined with " | "). */
  headers: Record<string, string>;
  /** The same headers as the server wrote them, lowercased names, one entry per value: the shape scripts/landing-gate/lib/headers.mjs judges. */
  rawHeaders: Record<string, string[]>;
  body: string;
}

/** The media origin the landing server is started with (playwright.config.ts): what its CSP names. */
export function mediaOrigin(): string {
  return new URL(process.env.PUBLIC_SITE_MEDIA_ORIGIN ?? "http://127.0.0.1:54321").origin;
}

/** A GET to the landing server with the label in the Host header and no redirect followed (a 301 is the answer). */
export function landingGet(label: string, path = "/", headers: Record<string, string> = {}): Promise<LandingResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${LANDING_ORIGIN}${path}`,
      { method: "GET", headers: { host: `${label}.${ROOT_DOMAIN}`, "accept-encoding": "identity", ...headers }, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const folded: Record<string, string> = {};
          const multi: Record<string, string[]> = {};
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            const k = res.rawHeaders[i]!.toLowerCase();
            folded[k] = k in folded ? `${folded[k]} | ${res.rawHeaders[i + 1]}` : res.rawHeaders[i + 1]!;
            (multi[k] ??= []).push(res.rawHeaders[i + 1]!);
          }
          resolve({ status: res.statusCode ?? 0, headers: folded, rawHeaders: multi, body: Buffer.concat(chunks).toString("utf-8") });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("landing request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** What makes two not-found answers "the same response": status, every header but Date, the body. */
export function sameness(r: LandingResponse): string {
  const headers = Object.entries(r.headers).filter(([name]) => name !== "date").sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ status: r.status, headers, body: r.body });
}
