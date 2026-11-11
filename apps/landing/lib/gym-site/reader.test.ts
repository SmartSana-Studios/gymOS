import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const READER_ENV = { PUBLIC_SITE_READER_PORT: "6543", PUBLIC_SITE_READER_DATABASE: "postgres", PUBLIC_SITE_READER_USER: "public_site_reader.ref", PUBLIC_SITE_READER_PASSWORD: "p" };

describe("the reader's pool", () => {
  const made: { options: Record<string, unknown>; on: ReturnType<typeof vi.fn> }[] = [];
  beforeEach(() => {
    made.length = 0;
    vi.resetModules();
    vi.doMock("pg", () => ({
      Pool: class {
        on = vi.fn();
        constructor(public options: Record<string, unknown>) {
          made.push(this as unknown as (typeof made)[number]);
        }
        async query() {
          return { rows: [] };
        }
      },
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("pg");
  });

  async function pool(host: string) {
    vi.stubEnv("PUBLIC_SITE_READER_HOST", host);
    for (const [k, v] of Object.entries(READER_ENV)) vi.stubEnv(k, v);
    const { reader } = await import("./db");
    await reader.readPage("fit");
    return made[0]!;
  }

  it("a remote host: one connection, 2 s connect timeout, 3 s query timeout, TLS verified against the pinned Supabase root CA, an error listener", async () => {
    const p = await pool("aws-0-eu-west-1.pooler.supabase.com");
    expect(p.options).toMatchObject({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 3000, ssl: { rejectUnauthorized: true, ca: expect.stringContaining("BEGIN CERTIFICATE") }, host: "aws-0-eu-west-1.pooler.supabase.com", port: 6543, user: "public_site_reader.ref" });
    expect(p.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
  it("localhost: no TLS", async () => {
    const p = await pool("localhost");
    expect(p.options.ssl).toBe(false);
    expect(p.options.max).toBe(1);
  });
  it("one pool per instance", async () => {
    vi.stubEnv("PUBLIC_SITE_READER_HOST", "127.0.0.1");
    for (const [k, v] of Object.entries(READER_ENV)) vi.stubEnv(k, v);
    const { reader } = await import("./db");
    await reader.readPage("a");
    await reader.readPage("b");
    expect(made).toHaveLength(1);
  });
  it("missing configuration fails with a coded error", async () => {
    const { reader } = await import("./db");
    await expect(reader.readPage("fit")).rejects.toMatchObject({ code: "reader_config_missing", message: "reader_config_missing" });
  });
});
