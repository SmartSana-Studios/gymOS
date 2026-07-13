import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // app/(admin)/layout.tsx, app/layout.tsx, and gyms/[id]/page.tsx all read
  // auth claims/locale inside explicit <Suspense> boundaries (Suspense-wrap
  // fix applied), so Cache Components no longer hard-fails a real `next
  // build`.
  cacheComponents: true,
  // @gymos/types gained real runtime code in Story 1.5 (Zod schemas,
  // mapSupabaseError) — previously `export {}` only, so this was harmless to
  // omit (flagged as deferred in Story 1.1's review). Now load-bearing:
  // without it, Next.js won't transpile the workspace package's TS source.
  transpilePackages: ["@gymos/types"],
};

export default nextConfig;
