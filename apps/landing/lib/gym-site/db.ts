import "server-only";
import { Pool } from "pg";
import { readReaderConfig } from "./env";
import { SUPABASE_ROOT_CA_2021 } from "./supabaseCa";
import { PAGE_REPORT_RESULTS, type PageReportResult } from "@gymos/types";
import {
  BEGIN_RW_SQL,
  COMMIT_SQL,
  CRAWL_CITIES_SQL,
  CRAWL_PAGES_SQL,
  DIRECTORY_CATEGORIES_SQL,
  DIRECTORY_CITIES_SQL,
  DIRECTORY_CITY_REDIRECT_SQL,
  DIRECTORY_CITY_SQL,
  DIRECTORY_CITY_TOTALS_SQL,
  DIRECTORY_COUNTRIES_SQL,
  DIRECTORY_COUNTRY_SQL,
  DIRECTORY_GYMS_SQL,
  DIRECTORY_MAP_CITIES_SQL,
  PAGE_SQL,
  REDIRECT_SQL,
  SUBMIT_REPORT_SQL,
} from "./readerSql";
import type { CityRow, CountryRow, CrawlReader, DirectoryReader, GymPage, GymRow } from "../directory/types";

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

/** TLS settings for the reader's connection: none for a local stack, otherwise verified against the pinned Supabase root CA. */
export function readerSsl(host: string): false | { ca: string; rejectUnauthorized: true } {
  return LOCAL_HOSTS.has(host) ? false : { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true };
}

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
    // The pooler requires TLS and its certificate is VERIFIED against the pinned Supabase root CA (supabaseCa.ts).
    ssl: readerSsl(cfg.host),
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

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

function countryRow(r: Record<string, unknown>): CountryRow {
  return { countryCode: str(r.country_code), nameEn: str(r.name_en), nameFr: str(r.name_fr), publishedCount: num(r.published_count), indexable: r.indexable === true };
}
function cityRow(r: Record<string, unknown>): CityRow {
  return { citySlug: str(r.city_slug), cityName: str(r.city_name), publishedCount: num(r.published_count), indexable: r.indexable === true };
}
function gymRow(r: Record<string, unknown>): GymRow {
  return {
    cityName: str(r.city_name),
    category: typeof r.category === "string" ? r.category : null,
    name: str(r.name),
    pageName: str(r.page_name),
    logoKey: typeof r.logo_key === "string" ? r.logo_key : null,
  };
}

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
        // judged BEFORE the commit: a result the database does not define rolls back, so the visitor's retry cannot store a second report
        const result = rows[0]?.result;
        if (typeof result !== "string" || !(PAGE_REPORT_RESULTS as readonly string[]).includes(result)) throw Object.assign(new Error("report_result_unexpected"), { code: "report_result_unexpected" });
        await client.query(COMMIT_SQL);
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

  /** Story 25.3: the directory reads, over the three 25.2 views. */
  const directory: DirectoryReader = {
    async readCountries() {
      const { rows } = await run(DIRECTORY_COUNTRIES_SQL, []);
      return rows.map(countryRow);
    },
    async readCountry(countryCode) {
      const { rows } = await run(DIRECTORY_COUNTRY_SQL, [countryCode]);
      return rows[0] ? countryRow(rows[0]) : null;
    },
    async readCityTotals() {
      const { rows } = await run(DIRECTORY_CITY_TOTALS_SQL, []);
      return rows.map((r) => ({ countryCode: str(r.country_code), listedCount: num(r.listed_count) }));
    },
    async readCities(countryCode) {
      const { rows } = await run(DIRECTORY_CITIES_SQL, [countryCode]);
      return rows.map(cityRow);
    },
    async readCity(countryCode, citySlug) {
      const { rows } = await run(DIRECTORY_CITY_SQL, [countryCode, citySlug]);
      return rows[0] ? cityRow(rows[0]) : null;
    },
    async readCategories(countryCode, citySlug) {
      const { rows } = await run(DIRECTORY_CATEGORIES_SQL, [countryCode, citySlug]);
      return rows.map((r) => r.category).filter((c): c is string => typeof c === "string");
    },
    async readGyms(countryCode, citySlug, category, page): Promise<GymPage> {
      const { rows } = await run(DIRECTORY_GYMS_SQL, [countryCode, citySlug, category, page]);
      return { rows: rows.map(gymRow), total: rows[0] ? num(rows[0].total) : 0 };
    },
    async readMapCities() {
      const { rows } = await run(DIRECTORY_MAP_CITIES_SQL, []);
      // lat and lng are numeric(9,6): pg returns them as strings. A value that is not a finite number is dropped (the city is listed, with no dot).
      return rows.flatMap((r) => {
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        return r.lat === null || r.lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)
          ? []
          : [{ countryCode: str(r.country_code), citySlug: str(r.city_slug), cityName: str(r.city_name), lat, lng, publishedCount: num(r.published_count) }];
      });
    },
    async readCitySlugRedirect(countryCode, oldSlug) {
      const { rows } = await run(DIRECTORY_CITY_REDIRECT_SQL, [countryCode, oldSlug]);
      const slug = rows[0]?.city_slug;
      return typeof slug === "string" ? slug : null;
    },
  };

  /** Story 25.5: the crawler reads. The countries and the city totals are the directory's own. */
  const crawl: CrawlReader = {
    readCountries: directory.readCountries,
    readCityTotals: directory.readCityTotals,
    async readIndexableCities() {
      const { rows } = await run(CRAWL_CITIES_SQL, []);
      return rows.map((r) => ({ countryCode: str(r.country_code), citySlug: str(r.city_slug) }));
    },
    async readLlmsPages(limit) {
      const { rows } = await run(CRAWL_PAGES_SQL, [limit]);
      return rows.map((r) => ({ name: str(r.name), template: r.template, schema_version: r.schema_version, content: r.content }));
    },
  };

  return {
    ...directory,
    ...crawl,
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
