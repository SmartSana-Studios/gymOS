// Story 24.11 (FR-205, AD-47): the page-media purge, as pure logic over an injected client so every branch is a test.
//
// One run (owner decision 2026-11-09: mark AFTER the delete; no claim stamp, no release):
//   1. list candidates (public.page_media_purge_candidates; nothing is stamped);
//   2. delete each object through the Storage API (never SQL; an object that is already gone is not an error), the derivative from the public
//      bucket and, for a deleted image, the original from the private one;
//   3. only for what was CONFIRMED deleted, mark the row purged (public.page_media_purge_mark, which re-checks the candidate rule). A run that is
//      killed or times out marked nothing it did not finish, so the next tick simply lists the rest again;
//   4. sweep orphans (objects with no row, older than an hour, which is also how a deleted gym's objects go), one bounded page;
//   5. write ONE job_runs row (public.record_page_media_purge_run): success only when nothing failed.
// Object keys never appear in a log line or in the job_runs text: counts only.

export const DERIVATIVE_BUCKET = "gym-page-media";
export const SRC_BUCKET = "gym-page-media-src";
export const CANDIDATE_LIMIT = 100;
export const ORPHAN_LIMIT = 50;

export interface CandidateRow {
  id: string;
  original_key: string;
  derivative_key: string;
  purge_derivative: boolean;
  purge_original: boolean;
}

export interface OrphanRow {
  bucket_id: string;
  name: string;
}

export interface PurgeClient {
  candidates(limit: number): Promise<CandidateRow[]>;
  /** Marks the parts that were confirmed deleted. Resolves true when every part asked for is now marked, false when the database refused (the page is live again). */
  mark(id: string, derivative: boolean, original: boolean): Promise<boolean>;
  orphans(limit: number): Promise<OrphanRow[]>;
  /** Removes one object through the Storage API. Rejects on any error (a missing object is not an error). */
  remove(bucket: string, key: string): Promise<void>;
  record(startedAt: Date, ok: boolean, summary: string): Promise<void>;
}

export interface RunResult {
  ok: boolean;
  listed: number;
  deleted: number;
  failed: number;
  /** Deleted, but the database refused the mark (the page was republished in between). Not a failure of the run; counted so it is visible. */
  markRefused: number;
  orphansRemoved: number;
  orphanFailures: number;
  /** A stage that threw (the listing, the orphan listing): the run is a failure whatever else happened. */
  stageError: string | null;
}

export async function runPurge(client: PurgeClient, now: () => Date = () => new Date()): Promise<RunResult> {
  const startedAt = now();
  const result: RunResult = { ok: false, listed: 0, deleted: 0, failed: 0, markRefused: 0, orphansRemoved: 0, orphanFailures: 0, stageError: null };

  let rows: CandidateRow[] = [];
  try {
    rows = await client.candidates(CANDIDATE_LIMIT);
  } catch {
    result.stageError = "list_failed";
  }
  result.listed = rows.length;

  for (const row of rows) {
    // independent attempts: a failure removing the original must not leave the public derivative behind, and the other way round
    const attempts: Promise<void>[] = [];
    const kinds: ("derivative" | "original")[] = [];
    if (row.purge_derivative) {
      attempts.push(client.remove(DERIVATIVE_BUCKET, row.derivative_key));
      kinds.push("derivative");
    }
    if (row.purge_original) {
      attempts.push(client.remove(SRC_BUCKET, row.original_key));
      kinds.push("original");
    }
    const settled = await Promise.allSettled(attempts);
    const confirmed = kinds.filter((_, i) => settled[i]!.status === "fulfilled");
    const anyFailed = confirmed.length < kinds.length;

    // mark exactly what was confirmed deleted; what failed stays unmarked and is listed again on the next tick
    if (confirmed.length > 0) {
      try {
        const marked = await client.mark(row.id, confirmed.includes("derivative"), confirmed.includes("original"));
        if (!marked) result.markRefused += 1;
      } catch {
        // the object is gone but the row is not marked: the next tick lists it, deletes (already gone is fine) and marks again
        result.failed += 1;
        continue;
      }
    }
    if (anyFailed) result.failed += 1;
    else result.deleted += 1;
  }

  try {
    const orphans = await client.orphans(ORPHAN_LIMIT);
    for (const o of orphans) {
      if (o.bucket_id !== DERIVATIVE_BUCKET && o.bucket_id !== SRC_BUCKET) continue;
      try {
        await client.remove(o.bucket_id, o.name);
        result.orphansRemoved += 1;
      } catch {
        result.orphanFailures += 1;
      }
    }
  } catch {
    result.stageError = result.stageError ?? "orphans_failed";
  }

  result.ok = result.stageError === null && result.failed === 0 && result.orphanFailures === 0;
  const summary =
    `listed ${result.listed}, deleted ${result.deleted}, failed ${result.failed}, mark refused ${result.markRefused}, orphans removed ${result.orphansRemoved}, orphan failures ${result.orphanFailures}` +
    (result.stageError ? `, stage error ${result.stageError}` : "");
  await client.record(startedAt, result.ok, summary);
  return result;
}
