import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { makeClient, type SupabaseLike } from "./client.ts";
import { createHandler } from "./handler.ts";
import type { PurgeClient } from "./purge.ts";

// Story 24.11 (FR-205, AD-47): deletes page-media Storage objects. Called every five minutes by the pg_cron job `page_media_purge` (pg_net, bearer
// secret). Deployed by the owner: `supabase functions deploy page-media-purge --no-verify-jwt` and `supabase secrets set PAGE_MEDIA_PURGE_SECRET=...`
// (the same value goes into Vault as `page_media_purge_secret`, with the function URL as `page_media_purge_url`; docs/decisions.md 24.11).
// The service-role client reaches the database only through the service-role-only functions of migration 0167 (candidates, mark, orphans, record) and the Storage API.

function supabaseClient(): PurgeClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("page-media-purge: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return makeClient(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SupabaseLike);
}

export default {
  fetch: createHandler({ secret: Deno.env.get("PAGE_MEDIA_PURGE_SECRET"), makeClient: supabaseClient }),
};
