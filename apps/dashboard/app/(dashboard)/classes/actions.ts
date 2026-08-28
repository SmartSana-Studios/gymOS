"use server";

import { classSchema, type AppError } from "@gymos/types";
import {
  insertClass,
  listSessionBookings,
  logClassChange,
  markAttendance,
  updateClass,
  type SessionBookingRow,
} from "@/services/classes";
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

  const { data, error } = await insertClass({
    name: cls.name,
    description: cls.description ?? null,
    coachId: cls.coachId,
    capacity: cls.capacity,
    scheduleType: cls.scheduleType,
    oneOffSessionAt: cls.oneOffSessionAt,
    recurrenceDays: cls.recurrenceDays,
    recurrenceTime: cls.recurrenceTime,
    recurrenceStartDate: cls.recurrenceStartDate,
  });
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logClassChange("class_created", data.id, {
    name: cls.name,
    coach_id: cls.coachId,
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

/** Class Edit. `scheduleChanged` (used only for the audit log's own
 * metadata) is derived from `update_class`'s own atomic, typed comparison
 * against the pre-update row -- see that RPC's Dev Notes in migration 0057.
 * Review fix: previously this comparison ran here, in JS, against a
 * pre-edit row read via a separate service-layer read -- comparing serialized
 * timestamp/time strings across the client/DB boundary that mismatched in
 * format (timestamptz "+00:00" vs ISO "Z", time "HH:mm:ss" vs "HH:mm") on
 * nearly every edit, making `scheduleChanged` a near-permanent false
 * positive that needlessly regenerated `class_sessions` on every save. */
export async function editClass(
  classId: string,
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = classSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const cls = parsed.data;

  const { error } = await updateClass(classId, {
    name: cls.name,
    description: cls.description ?? null,
    coachId: cls.coachId,
    capacity: cls.capacity,
    scheduleType: cls.scheduleType,
    oneOffSessionAt: cls.oneOffSessionAt,
    recurrenceDays: cls.recurrenceDays,
    recurrenceTime: cls.recurrenceTime,
    recurrenceStartDate: cls.recurrenceStartDate,
  });
  if (error) {
    return { data: null, error };
  }

  const { error: auditError } = await logClassChange("class_edited", classId, {
    name: cls.name,
    coach_id: cls.coachId,
    capacity: cls.capacity,
    schedule_type: cls.scheduleType,
  });
  if (auditError) {
    return {
      data: { id: classId },
      error: { code: "audit_log_failed", message: t("classes.errors.auditLogFailedEdit") },
    };
  }

  return { data: { id: classId }, error: null };
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
