import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-role Supabase client, backed by SUPABASE_SERVICE_ROLE_KEY.
 *
 * MUST NEVER be imported from a Client Component or any code path reachable
 * by the browser -- the service-role key bypasses RLS entirely. Its only
 * sanctioned use in this app is `supabase.auth.admin.*` (the Admin API),
 * which has no RLS-policy equivalent: creating an `auth.users` row cannot be
 * done through the regular session client (`lib/supabase/server.ts`) no
 * matter what RLS policies exist. Every other read/write in this app should
 * go through the regular session client instead.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
