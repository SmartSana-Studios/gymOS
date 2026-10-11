/** Identifies the deployment this bundle was built from (the git commit SHA on
 * Vercel). Inlined at build time via next.config's `env`, so a tab that has
 * been open since before a deploy keeps reporting its OWN build -- which is
 * exactly what lets it notice the server has moved on. "dev" outside Vercel,
 * where the update notice stays off. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
