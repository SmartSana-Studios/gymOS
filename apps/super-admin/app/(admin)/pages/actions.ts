"use server";

import {
  PAGE_APPEAL_DECISION_ERROR_CODES,
  PAGE_LIFT_ERROR_CODES,
  PAGE_REPORT_CLOSE_ERROR_CODES,
  PAGE_TAKEDOWN_ERROR_CODES,
  decidePageAppealSchema,
  dismissPageReportsSchema,
  gymPageNameSchema,
  gymPageStatusSchema,
  liftGymPageTakedownSchema,
  takeDownGymPageSchema,
  type AppError,
  type PageAppealStatus,
  type PageStatusState,
} from "@gymos/types";

import { authorizeOrRedirect } from "@/lib/authz-action";
import { STEP_UP_REQUIRED_CODE, consumeStepUp } from "@/lib/authz";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { createClient } from "@/lib/supabase/server";
import { mapAndLog } from "@/services/gyms";

// Story 24.11 (FR-203, FR-204; EXPERIENCE.md SA-16 to SA-18): the Super Admin side of takedown, reports and appeals. Every action is behind
// authorizeOrRedirect("platform.admin_access"); taking a page down and lifting a takedown also need a fresh authenticator code (step-up,
// bound to the gym). The database re-checks everything (a live Super Admin, the reason lengths, the state) and is the judge.

type Result<T> = Promise<{ data: T | null; error: AppError | null }>;

export interface PageReportRow {
  id: string;
  gymId: string;
  gymName: string;
  pageName: string;
  reason: string;
  details: string;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
  pageTakenDown: boolean;
}

export interface PageAppealRow {
  id: string;
  gymId: string;
  gymName: string;
  pageName: string | null;
  takedownReason: string;
  takedownNote: string | null;
  takenDownAt: string;
  appealReason: string;
  appealedAt: string;
  decision: "lift" | "uphold" | null;
  decisionReason: string | null;
  decidedAt: string | null;
  takedownLifted: boolean;
}

interface AppealDbRow {
  id: string; gym_id: string; gym_name: string; page_name: string | null; takedown_reason: string; takedown_note: string | null; taken_down_at: string;
  appeal_reason: string; appealed_at: string; decision: string | null; decision_reason: string | null; decided_at: string | null; takedown_lifted: boolean;
}

export interface GymPagePanelData {
  state: PageStatusState;
  reason: string | null;
  appeal: PageAppealStatus | null;
  pageName: string | null;
}

const KNOWN_CODES: Record<string, readonly string[]> = {
  take_down_gym_page: PAGE_TAKEDOWN_ERROR_CODES,
  lift_gym_page_takedown: PAGE_LIFT_ERROR_CODES,
  close_page_report: PAGE_REPORT_CLOSE_ERROR_CODES,
  decide_page_appeal: PAGE_APPEAL_DECISION_ERROR_CODES,
};

/** `<function>: <code>` from the database becomes a typed, translated error; anything else goes through the shared mapper (which logs it). */
async function typed(fn: keyof typeof KNOWN_CODES, error: { message?: string }, t: (k: string) => string): Promise<AppError> {
  const message = String(error.message ?? "");
  const code = KNOWN_CODES[fn]!.find((c) => message === `${fn}: ${c}`);
  if (code) return { code, message: t(`pages.errors.${code}`) };
  if (message === `${fn}: gym not found`) return { code: "gym_not_found", message: t("pages.errors.gym_not_found") };
  return mapAndLog(error);
}

async function stepUpRequired(t: (k: string) => string): Promise<AppError> {
  return { code: STEP_UP_REQUIRED_CODE, message: t("stepUp.title") };
}

/** The open reports, soonest due first. */
export async function listPageReports(): Result<PageReportRow[]> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_page_reports");
  if (error) return { data: null, error: await mapAndLog(error) };
  const reports = (data ?? []) as {
    id: string; gym_id: string; gym_name: string; page_name: string; reason: string; details: string;
    created_at: string; due_at: string; overdue: boolean; page_taken_down: boolean;
  }[];
  return {
    data: reports.map((r) => ({
      id: r.id,
      gymId: r.gym_id,
      gymName: r.gym_name,
      pageName: r.page_name,
      reason: r.reason,
      details: r.details,
      createdAt: r.created_at,
      dueAt: r.due_at,
      overdue: r.overdue,
      pageTakenDown: r.page_taken_down,
    })),
    error: null,
  };
}

/** Every appeal, the undecided first. */
export async function listPageAppeals(): Result<PageAppealRow[]> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_page_appeals");
  if (error) return { data: null, error: await mapAndLog(error) };
  const appeals = (data ?? []) as AppealDbRow[];
  return {
    data: appeals.map((r) => ({
      id: r.id,
      gymId: r.gym_id,
      gymName: r.gym_name,
      pageName: r.page_name,
      takedownReason: r.takedown_reason,
      takedownNote: r.takedown_note,
      takenDownAt: r.taken_down_at,
      appealReason: r.appeal_reason,
      appealedAt: r.appealed_at,
      decision: r.decision === "lift" || r.decision === "uphold" ? r.decision : null,
      decisionReason: r.decision_reason,
      decidedAt: r.decided_at,
      takedownLifted: r.takedown_lifted,
    })),
    error: null,
  };
}

/** The SA-03 Page block: the page state, the takedown reason code, the appeal state and the active page name of one gym. */
export async function getGymPagePanel(gymId: string): Result<GymPagePanelData> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const [status, name] = await Promise.all([
    supabase.rpc("get_gym_page_status", { p_gym_id: gymId }),
    supabase.rpc("get_gym_page_name", { p_gym_id: gymId }),
  ]);
  if (status.error) return { data: null, error: await mapAndLog(status.error) };
  const parsed = gymPageStatusSchema.safeParse(status.data);
  if (!parsed.success) {
    console.error("[getGymPagePanel] get_gym_page_status returned an unexpected shape", parsed.error.issues);
    return { data: null, error: { code: "unknown", message: "load_failed" } };
  }
  const pageName = name.error ? null : gymPageNameSchema.safeParse(name.data);
  return {
    data: {
      state: parsed.data.state,
      reason: parsed.data.taken_down_reason,
      appeal: parsed.data.appeal,
      pageName: pageName && pageName.success ? pageName.data.name : null,
    },
    error: null,
  };
}

/**
 * Takes a page down. Needs a fresh authenticator code bound to this gym (step-up); the answer `step_up_required` tells the dialog to ask.
 * `reportIds` (optional) are the open reports this answers: each is closed as `taken_down`, linked to the new takedown.
 */
export async function takeDownPage(input: unknown): Result<{ takedownId: string; reportsClosed: number }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = takeDownGymPageSchema.safeParse(input);
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.some((i) => i.path[0] === "note");
    return { data: null, error: { code: "validation_error", message: noteIssue ? t("pages.errors.note_required") : t("pages.errors.invalid") } };
  }
  if (!(await consumeStepUp(authz.actorId, "take_down_gym_page", parsed.data.gymId))) return { data: null, error: await stepUpRequired(t) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("take_down_gym_page", {
    p_gym_id: parsed.data.gymId,
    p_reason: parsed.data.reason,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return { data: null, error: await typed("take_down_gym_page", error, t) };

  let reportsClosed = 0;
  for (const id of parsed.data.reportIds ?? []) {
    const closed = await supabase.rpc("close_page_report", { p_id: id, p_outcome: "taken_down" });
    if (closed.error) console.error("[takeDownPage] a report could not be closed after the takedown", { code: closed.error.code });
    else reportsClosed += 1;
  }
  return { data: { takedownId: String((data as { takedown_id?: unknown } | null)?.takedown_id ?? ""), reportsClosed }, error: null };
}

/** Lifts a takedown (reason 3 to 500 characters, sent to the Owner). The page comes back UNPUBLISHED. Needs a fresh authenticator code. */
export async function liftPageTakedown(input: unknown): Result<{ lifted: true }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = liftGymPageTakedownSchema.safeParse(input);
  if (!parsed.success) return { data: null, error: { code: "validation_error", message: t("pages.errors.reason_required") } };
  if (!(await consumeStepUp(authz.actorId, "lift_gym_page_takedown", parsed.data.gymId))) return { data: null, error: await stepUpRequired(t) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("lift_gym_page_takedown", { p_gym_id: parsed.data.gymId, p_reason: parsed.data.reason });
  if (error) return { data: null, error: await typed("lift_gym_page_takedown", error, t) };
  return { data: { lifted: true }, error: null };
}

/** Closes the named open reports as dismissed, with one note (3 to 500 characters). */
export async function dismissPageReports(input: unknown): Result<{ closed: number }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = dismissPageReportsSchema.safeParse(input);
  if (!parsed.success) return { data: null, error: { code: "validation_error", message: t("pages.errors.note_required") } };
  const supabase = await createClient();
  let closed = 0;
  for (const id of parsed.data.reportIds) {
    const { error } = await supabase.rpc("close_page_report", { p_id: id, p_outcome: "dismissed", p_note: parsed.data.note });
    if (error) return { data: closed > 0 ? { closed } : null, error: await typed("close_page_report", error, t) };
    closed += 1;
  }
  return { data: { closed }, error: null };
}

/** Closes open reports of a page that is already taken down: the outcome is `taken_down`, linked to the open takedown. */
export async function closePageReportsTakenDown(input: unknown): Result<{ closed: number }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const ids = (input as { reportIds?: unknown } | null)?.reportIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === "string")) {
    return { data: null, error: { code: "validation_error", message: t("pages.errors.invalid") } };
  }
  const supabase = await createClient();
  let closed = 0;
  for (const id of ids as string[]) {
    const { error } = await supabase.rpc("close_page_report", { p_id: id, p_outcome: "taken_down" });
    if (error) return { data: closed > 0 ? { closed } : null, error: await typed("close_page_report", error, t) };
    closed += 1;
  }
  return { data: { closed }, error: null };
}

/**
 * Decides an appeal: `uphold` keeps the takedown and ends the appeal; `lift` runs the lift (the page returns unpublished) and so needs the
 * same fresh authenticator code, bound to the gym. The reason (3 to 500 characters) is sent to the Owner. `gymId` is checked against the appeal.
 */
export async function decidePageAppeal(input: unknown): Result<{ decision: "lift" | "uphold" }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { gymId?: unknown };
  const parsed = decidePageAppealSchema.safeParse(
    input && typeof input === "object" ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== "gymId")) : input,
  );
  if (!parsed.success || typeof raw.gymId !== "string") {
    return { data: null, error: { code: "validation_error", message: t("pages.errors.reason_required") } };
  }
  const supabase = await createClient();

  if (parsed.data.decision === "lift") {
    // the grant is bound to the gym of THIS appeal, read from the database, never taken on trust from the browser
    const appeals = await supabase.rpc("list_page_appeals");
    if (appeals.error) return { data: null, error: await mapAndLog(appeals.error) };
    const appeal = ((appeals.data ?? []) as AppealDbRow[]).find((a) => a.id === parsed.data.id);
    if (!appeal || appeal.gym_id !== raw.gymId) return { data: null, error: { code: "not_found", message: t("pages.errors.not_found") } };
    if (!(await consumeStepUp(authz.actorId, "lift_gym_page_takedown", appeal.gym_id))) return { data: null, error: await stepUpRequired(t) };
  }

  const { error } = await supabase.rpc("decide_page_appeal", { p_id: parsed.data.id, p_decision: parsed.data.decision, p_reason: parsed.data.reason });
  if (error) return { data: null, error: await typed("decide_page_appeal", error, t) };
  return { data: { decision: parsed.data.decision }, error: null };
}
