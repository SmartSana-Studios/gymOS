// Deno tests for the supabase adapter of the purge (Story 24.11): a recording fake proves the RPC names, the argument objects, the bucket and key
// handed to remove, and that every error becomes a throw. The names and arguments are the ones migration 0167 defines.
import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { makeClient, type SupabaseLike } from "./client.ts";

function recording(answers: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const calls: { kind: "rpc" | "remove"; name: string; args: unknown }[] = [];
  const supabase: SupabaseLike = {
    rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      return Promise.resolve({ data: answers[name]?.data ?? null, error: answers[name]?.error ?? null });
    },
    storage: {
      from(bucket) {
        return {
          remove(keys) {
            calls.push({ kind: "remove", name: bucket, args: keys });
            return Promise.resolve({ data: [], error: answers[`remove:${bucket}`]?.error ?? null });
          },
        };
      },
    },
  };
  return { calls, client: makeClient(supabase) };
}

Deno.test("candidates calls page_media_purge_candidates with p_limit and returns the rows", async () => {
  const rows = [{ id: "a", original_key: "g/o", derivative_key: "d.webp", purge_derivative: true, purge_original: false }];
  const { calls, client } = recording({ page_media_purge_candidates: { data: rows } });
  assertEquals(await client.candidates(100), rows);
  assertEquals(calls, [{ kind: "rpc", name: "page_media_purge_candidates", args: { p_limit: 100 } }]);
});

Deno.test("candidates with no data is an empty list", async () => {
  assertEquals(await recording().client.candidates(5), []);
});

Deno.test("mark calls page_media_purge_mark with id and the two flags and returns the boolean answer", async () => {
  const yes = recording({ page_media_purge_mark: { data: true } });
  assertEquals(await yes.client.mark("id-1", true, false), true);
  assertEquals(yes.calls, [{ kind: "rpc", name: "page_media_purge_mark", args: { p_id: "id-1", p_derivative: true, p_original: false } }]);
  assertEquals(await recording({ page_media_purge_mark: { data: false } }).client.mark("id-1", true, true), false);
  assertEquals(await recording().client.mark("id-1", false, true), false);
});

Deno.test("orphans calls page_media_purge_orphans with p_limit", async () => {
  const rows = [{ bucket_id: "gym-page-media", name: "x.webp" }];
  const { calls, client } = recording({ page_media_purge_orphans: { data: rows } });
  assertEquals(await client.orphans(50), rows);
  assertEquals(calls, [{ kind: "rpc", name: "page_media_purge_orphans", args: { p_limit: 50 } }]);
});

Deno.test("remove deletes exactly one key from exactly the named bucket through the Storage API", async () => {
  const { calls, client } = recording();
  await client.remove("gym-page-media-src", "gym/obj");
  assertEquals(calls, [{ kind: "remove", name: "gym-page-media-src", args: ["gym/obj"] }]);
});

Deno.test("record calls record_page_media_purge_run with the start time, the verdict and the summary", async () => {
  const { calls, client } = recording();
  await client.record(new Date("2026-11-09T10:00:00.000Z"), false, "listed 1, deleted 0");
  assertEquals(calls, [{ kind: "rpc", name: "record_page_media_purge_run", args: { p_started_at: "2026-11-09T10:00:00.000Z", p_ok: false, p_summary: "listed 1, deleted 0" } }]);
});

Deno.test("every database or storage error becomes a throw", async () => {
  const boom = { error: { message: "boom" } };
  await assertRejects(() => recording({ page_media_purge_candidates: boom }).client.candidates(1));
  await assertRejects(() => recording({ page_media_purge_mark: boom }).client.mark("i", true, true));
  await assertRejects(() => recording({ page_media_purge_orphans: boom }).client.orphans(1));
  await assertRejects(() => recording({ "remove:gym-page-media": boom }).client.remove("gym-page-media", "k"));
  await assertRejects(() => recording({ record_page_media_purge_run: boom }).client.record(new Date(), true, "s"));
});
