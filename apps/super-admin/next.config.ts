import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled -- app/(admin)/layout.tsx and gyms/[id]/page.tsx read auth
  // claims outside a <Suspense> boundary, which hard-fails a real `next
  // build` under Cache Components (confirmed: production build error on
  // "/gyms/[id]"). Needs a proper fix (Suspense-wrap the dynamic reads)
  // rather than staying disabled long-term -- see
  // docs/manual-walkthrough-findings-2026-07-13.md.
  cacheComponents: false,
  // @gymos/types gained real runtime code in Story 1.5 (Zod schemas,
  // mapSupabaseError) — previously `export {}` only, so this was harmless to
  // omit (flagged as deferred in Story 1.1's review). Now load-bearing:
  // without it, Next.js won't transpile the workspace package's TS source.
  transpilePackages: ["@gymos/types"],
};

export default nextConfig;
