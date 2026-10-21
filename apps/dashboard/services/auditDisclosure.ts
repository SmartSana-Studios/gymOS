import { createClient } from "@/lib/supabase/server";
import type { AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 23.8 (FR-187, 0142): the Owner's disclosure request about one audit row.
 *
 * The RPCs are the real boundary: Owner of this gym only, an audit row of this gym only, one open request per row, audited. The
 * answer is written by GymOS and delivered outside the product; the Owner also reads it here. Nothing here names a person.
 */
export interface DisclosureRequest {
  id: string;
  auditLogId: string;
  question: string;
  requestedAt: string;
  answerDueAt: string;
  answeredAt: string | null;
  answer: string | null;
}

export type FileDisclosureResult =
  | { data: { requestId: string; answerDueAt: string }; error: null }
  | { data: null; error: AppError };

const REFUSAL_KEY: Record<string, string> = {
  question_invalid: "audit.disclosure.errors.questionInvalid",
  not_found: "audit.disclosure.errors.notFound",
  already_open: "audit.disclosure.errors.alreadyOpen",
};

/** Files a request against one audit row of the caller's gym. A refusal code becomes Owner-facing copy (EN/FR). */
export async function fileDisclosureRequest(auditLogId: string, question: string): Promise<FileDisclosureResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("file_audit_disclosure_request", {
    p_audit_log_id: auditLogId,
    p_question: question,
  });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  const row = data?.[0];
  if (!row?.ok || !row.request_id || !row.answer_due_at) {
    const { t } = await getServerTranslation(await getRequestLocale());
    const key = (row?.code && REFUSAL_KEY[row.code]) || "common.somethingWentWrong";
    return { data: null, error: { code: "validation", message: t(key) } };
  }
  return { data: { requestId: row.request_id, answerDueAt: row.answer_due_at }, error: null };
}

/** The Owner's own gym's requests, newest first. Never returns who answered. */
export async function listDisclosureRequests(): Promise<{ data: DisclosureRequest[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_gym_disclosure_requests");
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return {
    data: (data ?? []).map((row: NonNullable<typeof data>[number]) => ({
      id: row.id,
      auditLogId: row.audit_log_id,
      question: row.question,
      requestedAt: row.requested_at,
      answerDueAt: row.answer_due_at,
      answeredAt: row.answered_at,
      answer: row.answer,
    })),
    error: null,
  };
}
