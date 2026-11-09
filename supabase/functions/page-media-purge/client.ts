// Story 24.11: the adapter between the purge logic and supabase-js. It takes a supabase-like object so a test can record every call.
import type { CandidateRow, OrphanRow, PurgeClient } from "./purge.ts";

export interface SupabaseLike {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): { remove(keys: string[]): PromiseLike<{ data: unknown; error: unknown }> } };
}

export function makeClient(supabase: SupabaseLike): PurgeClient {
  return {
    async candidates(limit: number): Promise<CandidateRow[]> {
      const { data, error } = await supabase.rpc("page_media_purge_candidates", { p_limit: limit });
      if (error) throw new Error("candidates failed");
      return (data ?? []) as CandidateRow[];
    },
    async mark(id: string, derivative: boolean, original: boolean): Promise<boolean> {
      const { data, error } = await supabase.rpc("page_media_purge_mark", { p_id: id, p_derivative: derivative, p_original: original });
      if (error) throw new Error("mark failed");
      return data === true;
    },
    async orphans(limit: number): Promise<OrphanRow[]> {
      const { data, error } = await supabase.rpc("page_media_purge_orphans", { p_limit: limit });
      if (error) throw new Error("orphans failed");
      return (data ?? []) as OrphanRow[];
    },
    async remove(bucket: string, key: string): Promise<void> {
      const { error } = await supabase.storage.from(bucket).remove([key]);
      if (error) throw new Error("remove failed");
    },
    async record(startedAt: Date, ok: boolean, summary: string): Promise<void> {
      const { error } = await supabase.rpc("record_page_media_purge_run", { p_started_at: startedAt.toISOString(), p_ok: ok, p_summary: summary });
      if (error) throw new Error("record failed");
    },
  };
}
