// Deno tests for the page-media purge (Story 24.11). Pure logic over a fake client; the handler over a fake run.
// Run: deno test supabase/functions/page-media-purge   (scripts/ci-local.sh, stage deno)
import { assertEquals, assertStrictEquals } from "jsr:@std/assert@^1";
import { createHandler, secretsMatch } from "./handler.ts";
import { CANDIDATE_LIMIT, DERIVATIVE_BUCKET, ORPHAN_LIMIT, SRC_BUCKET, runPurge, type CandidateRow, type OrphanRow, type PurgeClient } from "./purge.ts";

interface Fake {
  client: PurgeClient;
  removed: string[];
  marked: [string, boolean, boolean][];
  recorded: { ok: boolean; summary: string }[];
  calls: string[];
}

function fake(opts: {
  candidates?: CandidateRow[] | Error;
  orphans?: OrphanRow[] | Error;
  failRemove?: (bucket: string, key: string) => boolean;
  failMark?: boolean;
  refuseMark?: boolean;
}): Fake {
  const f: Fake = { client: null as unknown as PurgeClient, removed: [], marked: [], recorded: [], calls: [] };
  f.client = {
    candidates(limit) {
      f.calls.push(`candidates:${limit}`);
      if (opts.candidates instanceof Error) return Promise.reject(opts.candidates);
      return Promise.resolve(opts.candidates ?? []);
    },
    mark(id, d, o) {
      f.calls.push("mark");
      if (opts.failMark) return Promise.reject(new Error("x"));
      f.marked.push([id, d, o]);
      return Promise.resolve(!opts.refuseMark);
    },
    orphans(limit) {
      f.calls.push(`orphans:${limit}`);
      if (opts.orphans instanceof Error) return Promise.reject(opts.orphans);
      return Promise.resolve(opts.orphans ?? []);
    },
    remove(bucket, key) {
      f.calls.push("remove");
      if (opts.failRemove?.(bucket, key)) return Promise.reject(new Error("storage down"));
      f.removed.push(`${bucket}/${key}`);
      return Promise.resolve();
    },
    record(_s, ok, summary) {
      f.calls.push("record");
      f.recorded.push({ ok, summary });
      return Promise.resolve();
    },
  };
  return f;
}

const row = (n: number, d = true, o = false): CandidateRow => ({ id: `id-${n}`, original_key: `gym/orig-${n}`, derivative_key: `der-${n}.webp`, purge_derivative: d, purge_original: o });

Deno.test("a clean run deletes first, marks only afterwards, and records one success", async () => {
  const f = fake({ candidates: [row(1), row(2, true, true)] });
  const r = await runPurge(f.client);
  assertEquals(f.removed, [`${DERIVATIVE_BUCKET}/der-1.webp`, `${DERIVATIVE_BUCKET}/der-2.webp`, `${SRC_BUCKET}/gym/orig-2`]);
  assertEquals(f.marked, [["id-1", true, false], ["id-2", true, true]]);
  // every mark comes after the removals of ITS row: nothing is marked before the delete is confirmed
  assertEquals(f.calls, [`candidates:${CANDIDATE_LIMIT}`, "remove", "mark", "remove", "remove", "mark", `orphans:${ORPHAN_LIMIT}`, "record"]);
  assertEquals(r, { ok: true, listed: 2, deleted: 2, failed: 0, markRefused: 0, orphansRemoved: 0, orphanFailures: 0, stageError: null });
  assertEquals(f.recorded.length, 1);
  assertEquals(f.recorded[0]!.ok, true);
});

Deno.test("a missing object is not an error: the remove resolves and the row is marked", async () => {
  // the client contract: remove() resolves for an object that is already gone (supabase-js returns no error), so the row is marked and not retried forever
  const f = fake({ candidates: [row(1)] });
  const r = await runPurge(f.client);
  assertEquals([r.ok, r.deleted, f.marked.length], [true, 1, 1]);
});

Deno.test("a failed delete marks nothing for that part and is listed again on the next tick; no release call exists", async () => {
  const f = fake({ candidates: [row(1, true, true), row(2)], failRemove: (b, k) => b === SRC_BUCKET && k === "gym/orig-1" });
  const r = await runPurge(f.client);
  // row 1: the derivative was confirmed, the original failed: only the derivative is marked
  assertEquals(f.marked, [["id-1", true, false], ["id-2", true, false]]);
  assertEquals(f.removed, [`${DERIVATIVE_BUCKET}/der-1.webp`, `${DERIVATIVE_BUCKET}/der-2.webp`]);
  assertEquals([r.ok, r.listed, r.deleted, r.failed], [false, 2, 1, 1]);
  assertEquals(f.recorded.length, 1);
  assertEquals(f.recorded[0]!.ok, false);
  assertEquals("release" in f.client, false);
});

Deno.test("when every delete fails nothing is marked at all", async () => {
  const f = fake({ candidates: [row(1, true, true)], failRemove: () => true });
  const r = await runPurge(f.client);
  assertEquals(f.marked, []);
  assertEquals([r.ok, r.failed], [false, 1]);
});

Deno.test("a delete that succeeded but whose mark failed is a failure of the run (the next tick retries it)", async () => {
  const f = fake({ candidates: [row(1)], failMark: true });
  const r = await runPurge(f.client);
  assertEquals([r.ok, r.failed, r.deleted], [false, 1, 0]);
  assertEquals(f.recorded.length, 1);
});

Deno.test("a mark the database refuses (the page was republished) is counted, not a failure", async () => {
  const f = fake({ candidates: [row(1)], refuseMark: true });
  const r = await runPurge(f.client);
  assertEquals([r.ok, r.markRefused, r.failed], [true, 1, 0]);
  assertEquals(f.recorded[0]!.summary.includes("mark refused 1"), true);
});

Deno.test("a run that dies before it marks leaves no stamp: the work is just listed again", async () => {
  // simulate a kill after the first delete: the second remove never resolves a mark, and nothing was stamped before
  const f = fake({ candidates: [row(1), row(2)] });
  const original = f.client.remove;
  let removes = 0;
  f.client.remove = (b, k) => {
    removes++;
    if (removes === 2) return Promise.reject(new Error("killed"));
    return original(b, k);
  };
  await runPurge(f.client);
  assertEquals(f.marked, [["id-1", true, false]]);
});

Deno.test("a listing that fails is a recorded failure, not a crash", async () => {
  const a = fake({ candidates: new Error("db down") });
  const ra = await runPurge(a.client);
  assertEquals([ra.ok, ra.stageError], [false, "list_failed"]);
  assertEquals(a.recorded.length, 1);
});

Deno.test("orphans are removed from their own bucket; a bucket that is not ours is never touched; failures are counted", async () => {
  const f = fake({
    orphans: [
      { bucket_id: DERIVATIVE_BUCKET, name: "o1.webp" },
      { bucket_id: SRC_BUCKET, name: "gym/o2" },
      { bucket_id: "gym-logos", name: "gym/logo.png" },
      { bucket_id: DERIVATIVE_BUCKET, name: "bad.webp" },
    ],
    failRemove: (_b, k) => k === "bad.webp",
  });
  const r = await runPurge(f.client);
  assertEquals(f.removed, [`${DERIVATIVE_BUCKET}/o1.webp`, `${SRC_BUCKET}/gym/o2`]);
  assertEquals([r.orphansRemoved, r.orphanFailures, r.ok], [2, 1, false]);
});

Deno.test("an orphan listing that fails is a recorded failure, not a crash", async () => {
  const f = fake({ candidates: [row(1)], orphans: new Error("x") });
  const r = await runPurge(f.client);
  assertEquals([r.ok, r.stageError, r.deleted], [false, "orphans_failed", 1]);
  assertEquals(f.recorded.length, 1);
});

Deno.test("the job_runs text holds counts only: no object key", async () => {
  const f = fake({ candidates: [row(1, true, true)], failRemove: () => true });
  await runPurge(f.client);
  const text = f.recorded[0]!.summary;
  assertEquals(/der-1|orig-1|gym\//.test(text), false);
  assertEquals(text.startsWith("listed 1, deleted 0, failed 1"), true);
});

Deno.test("secretsMatch compares in constant shape and rejects any difference", async () => {
  assertStrictEquals(await secretsMatch("abc", "abc"), true);
  assertStrictEquals(await secretsMatch("abc", "abd"), false);
  assertStrictEquals(await secretsMatch("abc", "abcd"), false);
  assertStrictEquals(await secretsMatch("", "abc"), false);
});

Deno.test("the handler runs only for POST with the bearer secret", async () => {
  let ran = 0;
  const handler = createHandler({
    secret: "s3cret",
    makeClient: () => fake({}).client,
    run: () => {
      ran++;
      return Promise.resolve({ ok: true, listed: 3, deleted: 3, failed: 0, markRefused: 0, orphansRemoved: 1, orphanFailures: 0, stageError: null });
    },
  });
  const call = (init: RequestInit) => handler(new Request("https://x.example/functions/v1/page-media-purge", init));
  assertEquals((await call({ method: "GET" })).status, 405);
  assertEquals((await call({ method: "POST" })).status, 401);
  assertEquals((await call({ method: "POST", headers: { authorization: "Bearer wrong" } })).status, 401);
  assertEquals((await call({ method: "POST", headers: { authorization: "s3cret" } })).status, 401);
  assertEquals((await call({ method: "POST", headers: { authorization: "Basic s3cret" } })).status, 401);
  assertEquals(ran, 0);
  const ok = await call({ method: "POST", headers: { authorization: "Bearer s3cret" } });
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { ok: true, listed: 3, deleted: 3, failed: 0, markRefused: 0, orphansRemoved: 1, orphanFailures: 0 });
  assertEquals(ran, 1);
});

Deno.test("with no secret configured the handler fails closed and does nothing", async () => {
  let ran = 0;
  for (const secret of [undefined, ""]) {
    const handler = createHandler({ secret, makeClient: () => fake({}).client, run: () => (ran++, Promise.reject(new Error("must not run"))) });
    assertEquals((await handler(new Request("https://x.example/", { method: "POST", headers: { authorization: "Bearer " } }))).status, 503);
    assertEquals((await handler(new Request("https://x.example/", { method: "POST", headers: { authorization: "Bearer anything" } }))).status, 503);
  }
  assertEquals(ran, 0);
});

Deno.test("a run that fails is a 207 with counts; a run that throws is a 500 with nothing else", async () => {
  const partial = createHandler({
    secret: "s",
    makeClient: () => fake({}).client,
    run: () => Promise.resolve({ ok: false, listed: 2, deleted: 1, failed: 1, markRefused: 0, orphansRemoved: 0, orphanFailures: 0, stageError: null }),
  });
  assertEquals((await partial(new Request("https://x.example/", { method: "POST", headers: { authorization: "Bearer s" } }))).status, 207);
  const broken = createHandler({ secret: "s", makeClient: () => fake({}).client, run: () => Promise.reject(new Error("secret detail")) });
  const r = await broken(new Request("https://x.example/", { method: "POST", headers: { authorization: "Bearer s" } }));
  assertEquals(r.status, 500);
  assertEquals(await r.text(), "{}");
});
