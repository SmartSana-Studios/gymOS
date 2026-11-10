/** The one place this app reads the host's environment variables (story 24.2, AD-43), so nothing else is tied to Vercel.
 * `APP_ENV` and `GIT_SHA` are the host-neutral names; `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` remain the fallback while
 * the app is hosted there. scripts/check-host-neutral-env.mjs fails CI if any other source file reads the Vercel names.
 * Dependency-free so next.config.ts can import it by relative path. */
export type AppEnvironment = "production" | "preview" | "development";

type Env = Record<string, string | undefined>;

function recognised(value: string | undefined): AppEnvironment | undefined {
  const v = value?.trim().toLowerCase();
  return v === "production" || v === "preview" || v === "development" ? v : undefined;
}

/** `APP_ENV` if it names an environment (trimmed, any case), else `VERCEL_ENV` if it does, else "development". */
export function appEnvironment(env: Env = process.env): AppEnvironment {
  return recognised(env.APP_ENV) ?? recognised(env.VERCEL_ENV) ?? "development";
}

/** The commit this build came from: `GIT_SHA`, else `VERCEL_GIT_COMMIT_SHA` (each trimmed, blank = unset), else "dev" (the update
 * notice stays off). Evaluated at build time by next.config.ts, so GIT_SHA must be set at build, not only at runtime. */
export function buildId(env: Env = process.env): string {
  return env.GIT_SHA?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim() || "dev";
}
