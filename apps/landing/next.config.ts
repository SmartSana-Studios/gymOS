import type { NextConfig } from "next";

// Deliberately minimal compared with apps/dashboard's config. The landing
// page has no Supabase client, no auth, no Sentry and no PostHog: it is
// fully static marketing copy, so there is nothing to instrument and no
// per-request state to cache around.
const nextConfig: NextConfig = {
  // Same reasoning as apps/dashboard: Next 16 treats any dev host other than
  // the one the dev server booted with as cross-origin and rejects the HMR
  // socket, which leaves the page served as inert un-hydrated HTML. Dev-only.
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
};

export default nextConfig;
