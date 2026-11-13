// The kit's configuration, read from the environment in one place. Local defaults describe `run-local.sh`; staging overrides them (see README.md).
const env = process.env;
// `{label}` in BASE_URL means staging: the local fixture labels do not exist there.
const stagingMode = (env.BASE_URL ?? "").includes("{label}");

export const config = {
  /** Where requests go. `{label}` in it is replaced by the page label (staging, real wildcard DNS). Without it the label goes in the Host header. */
  baseUrl: env.BASE_URL ?? "http://127.0.0.1:3200",
  /** The root domain the labels live under (`localhost` locally, the staging root on staging). */
  rootDomain: (env.ROOT_DOMAIN ?? "localhost").toLowerCase(),
  /** The storage origin the pages are configured with (PUBLIC_SITE_MEDIA_ORIGIN of the server under test); the CSP names it. */
  mediaOrigin: env.GATE_MEDIA_ORIGIN ?? "http://127.0.0.1:3911",
  /** `none`, or `vercel` to allow the headers Vercel adds in front of the app (printed either way). */
  platform: (env.GATE_PLATFORM ?? "none").toLowerCase(),
  extraAllowedHeaders: (env.GATE_ALLOWED_EXTRA_HEADERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  labels: {
    published: env.GATE_LABEL_PUBLISHED ?? "gate-grace",
    /** An old name inside its 12 months; answers a single 301 to the published label. REQUIRED with a `{label}` BASE_URL (the headers of a redirect are part of the gate); locally an empty value skips it. */
    redirectOld: env.GATE_LABEL_REDIRECT_OLD ?? "gate-grace-old",
    unpublished: env.GATE_LABEL_UNPUBLISHED ?? "gate-draft",
    takenDown: env.GATE_LABEL_TAKEN_DOWN ?? "gate-down",
    /** Optional: a page of a suspended gym. On staging it defaults to none (skipped), never to a label that does not exist there. */
    suspended: env.GATE_LABEL_SUSPENDED ?? (stagingMode ? "" : "gate-paused"),
    unknown: env.GATE_LABEL_UNKNOWN ?? "gate-nobody-here",
    /** Reserved, and not a DNS record of its own on the zone (so it reaches the landing app). */
    reserved: env.GATE_LABEL_RESERVED ?? "test",
    /** Breaks the name grammar (a double hyphen): the proxy never lets it near the database. */
    invalid: env.GATE_LABEL_INVALID ?? "gate--bad",
  },
  /** Story 25.3: the directory pages under test: a country and a city (slugs) that list the published fixture gym. Locally the seeded Garoua, Cameroon. */
  directory: {
    country: env.GATE_DIRECTORY_COUNTRY ?? (stagingMode ? "" : "cm"),
    city: env.GATE_DIRECTORY_CITY ?? (stagingMode ? "" : "garoua"),
    /** The host label the directory lives on. */
    label: env.GATE_DIRECTORY_LABEL ?? "www",
  },
  /** Story 25.6: the share (0 to 1) of the load check's requests that are directory pages (the rest are page-label scans). 0 turns the directory mix off. */
  // an empty value is NaN (load.mjs rejects it), not 0: `Number("")` would turn the directory mix off without a word
  loadDirectoryShare: env.GATE_LOAD_DIRECTORY_SHARE === undefined ? 0.2 : env.GATE_LOAD_DIRECTORY_SHARE.trim() === "" ? NaN : Number(env.GATE_LOAD_DIRECTORY_SHARE),
  /** An admin connection used ONLY to read pg_stat_activity and pg_roles (needs pg_monitor or a superuser). */
  adminDbUrl: env.GATE_ADMIN_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  readerRole: env.GATE_READER_ROLE ?? "public_site_reader",
  /** A string only the published fixture page carries (its gym name); staging pages say their own. */
  publishedMarker: env.GATE_PUBLISHED_MARKER ?? "GATE FIT",
};

/**
 * In `{label}` mode (staging) the local fixture labels for the unpublished and taken-down pages do not exist, so an unset variable would make the
 * uniformity check compare an unknown label with an unknown label. Returns the variables that must be set (empty when nothing is wrong).
 */
export function missingStagingLabels(cfg = config, env_ = env) {
  if (!cfg.baseUrl.includes("{label}")) return [];
  return [["GATE_LABEL_PUBLISHED", "published"], ["GATE_LABEL_REDIRECT_OLD", "redirectOld"], ["GATE_LABEL_UNPUBLISHED", "unpublished"], ["GATE_LABEL_TAKEN_DOWN", "takenDown"]]
    .filter(([name]) => !env_[name]).map(([name]) => name);
}

export function schemeFor(rootDomain) {
  return /^localhost(:\d+)?$/i.test(rootDomain) ? "http" : "https";
}

/** Where to send a request for `label`: the connection URL and the Host header (undefined when the label is in the URL itself). */
export function targetFor(label, path = "/", cfg = config) {
  if (cfg.baseUrl.includes("{label}")) return { url: new URL(path, cfg.baseUrl.replace("{label}", label)).href, host: undefined };
  const base = new URL(cfg.baseUrl);
  return { url: new URL(path, base).href, host: `${label}.${cfg.rootDomain}` };
}

/** The URL a browser opens for `label`: only possible with a `{label}` template or a `localhost` root (Chromium resolves *.localhost itself). */
export function browserUrlFor(label, path = "/", cfg = config) {
  if (cfg.baseUrl.includes("{label}")) return new URL(path, cfg.baseUrl.replace("{label}", label)).href;
  if (/^localhost$/i.test(cfg.rootDomain)) {
    const base = new URL(cfg.baseUrl);
    return new URL(path, `${base.protocol}//${label}.localhost${base.port ? `:${base.port}` : ""}`).href;
  }
  throw new Error("lcp: set BASE_URL with a {label} placeholder (e.g. https://{label}.staging.example.com) or use ROOT_DOMAIN=localhost");
}
