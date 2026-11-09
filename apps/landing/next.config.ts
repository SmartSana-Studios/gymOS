import type { NextConfig } from "next";

// Deliberately minimal compared with apps/dashboard's config. The landing
// page has no Supabase client, no auth, no Sentry and no PostHog: it is
// static marketing copy, so there is nothing to instrument and no
// per-request state to cache around.
const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (gym page templates, shared types).
  transpilePackages: ["@gymos/types", "@gymos/page-templates"],
  // Same reasoning as apps/dashboard: Next 16 treats any dev host other than
  // the one the dev server booted with as cross-origin and rejects the HMR
  // socket, which leaves the page served as inert un-hydrated HTML. Dev-only.
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
  // The self-hosted gym page fonts (Story 24.10) are served from the page's own origin (font-src 'self'). A font file is never edited in
  // place (a new weight or version gets a new name), so it can be cached for a year.
  async headers() {
    return [{ source: "/fonts/:file", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  images: {
    // Gym photography is served from Unsplash's CDN rather than committed to
    // this repo: the images are large, licence-cleared for commercial use,
    // and the reference site this page is modelled on sources them the same
    // way. Narrowed to the one host -- `remotePatterns` is an allow-list, and
    // leaving it open would let any future `<Image src>` typo proxy an
    // arbitrary origin through this app's own optimizer.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;
