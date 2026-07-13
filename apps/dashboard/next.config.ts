import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // app/layout.tsx and app/(dashboard)/layout.tsx both read locale/auth
  // context inside explicit <Suspense> boundaries (Suspense-wrap fix
  // applied), so Cache Components no longer hard-fails a real `next build`.
  cacheComponents: true,
};

export default nextConfig;
