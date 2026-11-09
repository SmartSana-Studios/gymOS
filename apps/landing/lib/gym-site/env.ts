// Story 24.10: configuration of the public gym pages, read from the environment in ONE place. No Supabase URL, anon key, service-role key or
// JWT secret is read anywhere in this app (AD-42; scripts/check-landing-no-supabase.mjs). The database is reached as `public_site_reader` with
// five separate variables (the pooler user is `public_site_reader.<project_ref>`).

export interface GymSiteConfig {
  /** `gymosapps.com`; `localhost` (or `localhost:3002`) in development. Undefined in production when unset: gym hosting is then off. */
  rootDomain: string | undefined;
  /** The storage origin (AD-47), e.g. `https://abcd.supabase.co`. Undefined when unset. */
  mediaOrigin: string | undefined;
  /** Story 24.11: the server-only HMAC key of the report source hash. Undefined when unset: /report then answers the uniform not-found. */
  reportKey: string | undefined;
}

/** `https://host` for a configured origin, or undefined when it is not a plain http(s) origin. */
export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** At least 16 characters: a shorter key is treated as unset (the report form is then off, never weakly keyed). */
function readReportKey(env: Record<string, string | undefined>): string | undefined {
  const key = env.PUBLIC_SITE_REPORT_KEY?.trim();
  return key && key.length >= 16 ? key : undefined;
}

export function readConfig(env: Record<string, string | undefined> = process.env): GymSiteConfig {
  const raw = env.PUBLIC_SITE_ROOT_DOMAIN?.trim().toLowerCase();
  // a bare host name with an optional port: a scheme or a path (`https://gymosapps.com`) would silently turn gym hosting into the marketing site
  if (raw && !/^[a-z0-9.-]+(:\d{1,5})?$/.test(raw)) {
    console.error(JSON.stringify({ event: "gym_site_config_invalid", variable: "PUBLIC_SITE_ROOT_DOMAIN" }));
    return { rootDomain: undefined, mediaOrigin: normalizeOrigin(env.PUBLIC_SITE_MEDIA_ORIGIN?.trim()), reportKey: readReportKey(env) };
  }
  return {
    rootDomain: raw || (env.NODE_ENV === "production" ? undefined : "localhost"),
    mediaOrigin: normalizeOrigin(env.PUBLIC_SITE_MEDIA_ORIGIN?.trim()),
    reportKey: readReportKey(env),
  };
}

export interface ReaderConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The reader connection settings, or undefined when any of the five is missing. */
export function readReaderConfig(env: Record<string, string | undefined> = process.env): ReaderConfig | undefined {
  const host = env.PUBLIC_SITE_READER_HOST;
  const port = Number(env.PUBLIC_SITE_READER_PORT);
  const database = env.PUBLIC_SITE_READER_DATABASE;
  const user = env.PUBLIC_SITE_READER_USER;
  const password = env.PUBLIC_SITE_READER_PASSWORD;
  if (!host || !Number.isInteger(port) || port <= 0 || !database || !user || !password) return undefined;
  return { host, port, database, user, password };
}
