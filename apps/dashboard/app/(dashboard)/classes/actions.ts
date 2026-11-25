"use server";

import { classSchema, type AppError } from "@gymos/types";
import {
  cancelClass,
  insertClass,
  listSessionBookings,
  logClassChange,
  markAttendance,
  updateClass,
  type LeftUnchangedSession,
  type SessionBookingRow,
} from "@/services/classes";
import { getDashboardShellContext } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Class Create. `{ data, error }` never-throws contract, matches
 * createPlan's established Process Pattern. No gymId argument -- every class
 * action here is implicitly scoped to the caller's own gym via
 * getCallerGymId() inside the service layer, never a client-supplied gym id. */
export async function createClass(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = classSchema.safeParse(input);
  if (!parsed.success) {
    // classSchema's own issue messages are hardcoded English literals (not
    // routed through i18n) -- always fall back to the localized generic
    // message instead, same discipline as createPlan's own comment
    // documents. ClassModal's client-side guards already cover the common
    // cases with properly translated copy before safeParse ever runs.
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const cls = parsed.data;

  // Story 29.3: a Coach creates only their own classes. The audit action is chosen here from the server-resolved role (the claim of the
  // signed-in session, as the shell reads it) because create_class writes no audit row of its own; the database stays the authority on who may
  // write. A Coach's class is always assigned to their own member id from the same shell context, whatever the client sent.
  const { data: shell, error: shellError } = await getDashboardShellContext();
  if (shellError || !shell) {
    return { data: null, error: { code: "load_failed", message: t("common.loadError") } };
  }
  const isCoach = shell.role === "coach";
  const coachId = isCoach && shell.memberId ? shell.memberId : cls.coachId;

  const { data, error } = await insertClass({
    name: cls.name,
    description: cls.description ?? null,
    coachId,
    capacity: cls.capacity,
    scheduleType: cls.scheduleType,
    oneOffSessionAt: cls.oneOffSessionAt,
    slots: cls.slots,
    recurrenceStartDate: cls.recurrenceStartDate,
  });
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logClassChange(isCoach ? "class_created_by_coach" : "class_created", data.id, {
    name: cls.name,
    coach_id: coachId,
    capacity: cls.capacity,
    schedule_type: cls.scheduleType,
  });
  if (auditError) {
    return {
      data,
      error: { code: "audit_log_failed", message: t("classes.errors.auditLogFailedCreate") },
    };
  }

  return { data, error: null };
}

/** Class Edit. Calls `update_class` (the `p_slots` overload, 0181), which compares the old and new schedule inside the database and
 * returns the future sessions with bookings it left on their old time (`leftUnchanged`, shown in the modal's result view). The weekly-times
 * audit row (`class_times_changed`) is written by the database itself, only when the times changed; the `class_edited` row written here
 * carries no schedule comparison. */
export async function editClass(
  classId: string,
  input: unknown,
): Promise<{ data: { id: string; leftUnchanged: LeftUnchangedSession[] } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = classSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const cls = parsed.data;

  const { data: updated, error } = await updateClass(classId, {
    name: cls.name,
    description: cls.description ?? null,
    coachId: cls.coachId,
    capacity: cls.capacity,
    scheduleType: cls.scheduleType,
    oneOffSessionAt: cls.oneOffSessionAt,
    slots: cls.slots,
    recurrenceStartDate: cls.recurrenceStartDate,
  });
  if (error || !updated) {
    return { data: null, error };
  }
  const leftUnchanged = updated.leftUnchanged;

  const { error: auditError } = await logClassChange("class_edited", classId, {
    name: cls.name,
    coach_id: cls.coachId,
    capacity: cls.capacity,
    schedule_type: cls.scheduleType,
  });
  if (auditError) {
    return {
      data: { id: classId, leftUnchanged },
      error: { code: "audit_log_failed", message: t("classes.errors.auditLogFailedEdit") },
    };
  }

  return { data: { id: classId, leftUnchanged }, error: null };
}

/** Story 29.2: cancels a class (Manager, Supervisor, Owner, and since Story 29.3 a Coach for their own classes; the database refuses everyone else). The audit row `class_cancelled` is written by
 * `cancel_class()` itself, so there is no separate audit call here. `{ data, error }` never throws, like the other class actions. */
export async function cancelClassAction(
  classId: string,
): Promise<{ data: { bookingsCancelled: number } | null; error: AppError | null }> {
  return cancelClass(classId);
}

// No deleteClass action -- not in scope (no delete feature, no AC asks for one).

/** Story 12.3: thin wrapper over listSessionBookings(), no Zod schema --
 * takes a single uuid-shaped string with no user-authored free-text input
 * to validate, matching dismissAlert-style thin-wrapper actions elsewhere
 * in this app rather than createClass/editClass's schema-validated shape. */
export async function getSessionBookingsAction(
  classSessionId: string,
): Promise<{ data: SessionBookingRow[] | null; error: AppError | null }> {
  return listSessionBookings(classSessionId);
}

/** Story 12.3: thin wrapper over markAttendance() -- same no-schema
 * reasoning as getSessionBookingsAction above. */
export async function markAttendanceAction(
  bookingId: string,
): Promise<{ data: SessionBookingRow | null; rejected: boolean; error: AppError | null }> {
  return markAttendance(bookingId);
}
