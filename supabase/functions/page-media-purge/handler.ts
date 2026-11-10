// Story 24.11: the HTTP face of the purge. POST only, and only with `Authorization: Bearer <PAGE_MEDIA_PURGE_SECRET>`; pg_cron reaches it through pg_net
// with that secret kept in Vault. Without a configured secret the function answers 503 and does nothing. The answer carries counts only.
import { runPurge, type PurgeClient, type RunResult } from "./purge.ts";

const encoder = new TextEncoder();

/** Constant-time comparison of two strings through their SHA-256 digests (equal length by construction). */
export async function secretsMatch(given: string, wanted: string): Promise<boolean> {
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(given)), crypto.subtle.digest("SHA-256", encoder.encode(wanted))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function json(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export interface HandlerDeps {
  secret: string | undefined;
  makeClient(): PurgeClient;
  run?: (client: PurgeClient) => Promise<RunResult>;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return json(405);
    if (!deps.secret) {
      console.error(JSON.stringify({ event: "page_media_purge_config_missing", variable: "PAGE_MEDIA_PURGE_SECRET" }));
      return json(503);
    }
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ") || !(await secretsMatch(header.slice("Bearer ".length), deps.secret))) return json(401);

    let result: RunResult;
    try {
      result = await (deps.run ?? runPurge)(deps.makeClient());
    } catch (e) {
      console.error(JSON.stringify({ event: "page_media_purge_run_failed", name: e instanceof Error ? e.name : "unknown" }));
      return json(500);
    }
    return json(result.ok ? 200 : 207, {
      ok: result.ok,
      listed: result.listed,
      deleted: result.deleted,
      failed: result.failed,
      markRefused: result.markRefused,
      orphansRemoved: result.orphansRemoved,
      orphanFailures: result.orphanFailures,
    });
  };
}
