import "server-only";
import { Pool } from "pg";
import { readReaderConfig } from "./env";

// Story 24.10 (AD-42): the ONLY database access of the public site. Server-only, driver `pg`, connected as `public_site_reader` through the
// pooler, selecting from `public_site.*` views and nothing else. Pool of ONE connection per instance (the role's CONNECTION LIMIT is sized as
// the sum of the instances' pools plus one), no session state (no SET, no named prepared statement: each query is one unnamed statement, safe
// behind a transaction-mode pooler), one retry on `53300` (too many connections) or a connect timeout, 2 s connect timeout.

export interface PageRow {
  template: unknown;
  schema_version: unknown;
  content: unknown;
}

export interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

let pool: Pool | undefined;

function defaultPool(): Queryable {
  if (pool) return pool;
  const cfg = readReaderConfig();
  if (!cfg) throw Object.assign(new Error("reader_config_missing"), { code: "reader_config_missing" });
  pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 1,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    // The pooler requires TLS. The connection is encrypted; the server certificate is not verified yet (see deferred-work.md).
    ssl: LOCAL_HOSTS.has(cfg.host) ? false : { rejectUnauthorized: false },
  });
  // An idle client that the pooler drops must not crash the process: the next query opens a new one.
  pool.on("error", () => undefined);
  return pool;
}

/** `53300` is Postgres' too_many_connections; a connect timeout is pg's own message. */
export function isRetryable(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "53300" || /timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(err?.message ?? "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createReader(getPool: () => Queryable = defaultPool, retryDelayMs = 75) {
  async function run(text: string, values: unknown[]) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getPool().query(text, values);
      } catch (e) {
        if (attempt === 0 && isRetryable(e)) {
          await sleep(retryDelayMs);
          continue;
        }
        throw e;
      }
    }
  }
  return {
    /** The visible page of a name, or null. The view holds the one visibility predicate. */
    async readPage(name: string): Promise<PageRow | null> {
      const { rows } = await run("select template, schema_version, content from public_site.pages where name = $1 limit 1", [name]);
      const r = rows[0];
      return r ? { template: r.template, schema_version: r.schema_version, content: r.content } : null;
    },
    /** The CURRENT name of an old name inside its 12 months, only while the current page is visible. */
    async readRedirect(oldName: string): Promise<string | null> {
      const { rows } = await run("select name from public_site.page_redirects where old_name = $1 limit 1", [oldName]);
      const n = rows[0]?.name;
      return typeof n === "string" ? n : null;
    },
  };
}

export const reader = createReader();
