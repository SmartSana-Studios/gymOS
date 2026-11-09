import "server-only";
import { Pool } from "pg";
import { readReaderConfig } from "./env";
import { PAGE_REPORT_RESULTS, type PageReportResult } from "@gymos/types";
import { BEGIN_RW_SQL, COMMIT_SQL, PAGE_SQL, REDIRECT_SQL, SUBMIT_REPORT_SQL } from "./readerSql";

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
  /** Story 24.11: one checked-out connection, for the report's `begin read write; select ...; commit`. */
  connect?(): Promise<TxClient>;
}

export interface TxClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** `release(true)` destroys the connection instead of returning it to the pool (used after a failed transaction). */
  release(destroy?: boolean): void;
}

export interface ReportSubmission {
  name: string;
  reason: string;
  details: string;
  /** HMAC-SHA256(PUBLIC_SITE_REPORT_KEY, client ip) as 64 hex characters. Never the address itself. */
  sourceHash: string;
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
  async function submit(r: ReportSubmission): Promise<PageReportResult> {
    for (let attempt = 0; ; attempt++) {
      const p = getPool();
      if (!p.connect) throw Object.assign(new Error("reader_cannot_transact"), { code: "reader_cannot_transact" });
      let client: TxClient;
      try {
        client = await p.connect();
      } catch (e) {
        if (attempt === 0 && isRetryable(e)) {
          await sleep(retryDelayMs);
          continue;
        }
        throw e;
      }
      let broken = false;
      try {
        // The role is default_transaction_read_only; the one write is a short read-write transaction on THIS connection (no session state
        // survives it: a transaction-mode pooler keeps the connection for the three statements).
        await client.query(BEGIN_RW_SQL);
        const { rows } = await client.query(SUBMIT_REPORT_SQL, [r.name, r.reason, r.details, r.sourceHash]);
        await client.query(COMMIT_SQL);
        const result = rows[0]?.result;
        if (typeof result !== "string" || !(PAGE_REPORT_RESULTS as readonly string[]).includes(result)) throw Object.assign(new Error("report_result_unexpected"), { code: "report_result_unexpected" });
        return result as PageReportResult;
      } catch (e) {
        broken = true;
        try {
          await client.query("rollback");
        } catch {
          // the connection is destroyed below
        }
        throw e;
      } finally {
        client.release(broken);
      }
    }
  }

  return {
    submitReport: submit,
    /** The visible page of a name, or null. The view holds the one visibility predicate. */
    async readPage(name: string): Promise<PageRow | null> {
      const { rows } = await run(PAGE_SQL, [name]);
      const r = rows[0];
      return r ? { template: r.template, schema_version: r.schema_version, content: r.content } : null;
    },
    /** The CURRENT name of an old name inside its 12 months, only while the current page is visible. */
    async readRedirect(oldName: string): Promise<string | null> {
      const { rows } = await run(REDIRECT_SQL, [oldName]);
      const n = rows[0]?.name;
      return typeof n === "string" ? n : null;
    },
  };
}

export const reader = createReader();
