// Reads the same env vars apps/dashboard's own lib/supabase/{client,admin}.ts
// read -- `.env.local` locally (loaded once by playwright.config.ts's
// top-of-file process.loadEnvFile, inherited by every worker process this
// runner spawns), real job-level env vars in CI (no `.env.local` file
// there, matching this project's fixed local-dev demo keys already visible
// in `apps/dashboard/.env.local`).

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`e2e: missing required env var ${name}`);
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}
