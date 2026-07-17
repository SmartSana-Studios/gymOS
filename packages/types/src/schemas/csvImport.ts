import { z } from "zod";

import { subscriptionStatusSchema } from "./member";

// Story 2.4: CSV Member Import (FR-008, FR-009).
//
// FR-008's exact column list/order -- the single source of truth for both
// the template-download header (CsvImportModal's Blob-download button) and
// header-validation (mapCsvRows, order-independent).
export const CSV_TEMPLATE_COLUMNS = [
  "member_name",
  "phone",
  "plan_type",
  "join_date",
  "subscription_status",
  "expiry_date",
] as const;

// Scope Note #6: structurally mirrors createMemberSchema's (member.ts)
// cross-field invariants, but as its own schema with AD-07's exact per-row
// copy and a `planName` (not `planId`) field -- plan resolution against
// this gym's configured plans is a separate, DB-dependent step (Task 3),
// not something this schema layer can see.
const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Invalid format — expected E.164 (e.g. +237...)");

// Date-only string comparison (never `new Date(val) <= new Date()`) -- same
// rationale as member.ts's own todayIso: an ISO "YYYY-MM-DD" string parses
// as UTC midnight, so comparing it against a full local `new Date()`
// instant can misclassify a same-day boundary value depending on the
// caller's timezone offset relative to UTC.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// A blank CSV cell must be treated as "not provided" (undefined), not as an
// invalid date string -- z.iso.date() would otherwise reject "" with
// "Invalid date format" instead of letting .optional() apply.
function blankToUndefined(val: unknown): unknown {
  return typeof val === "string" && val.trim() === "" ? undefined : val;
}

export const csvMemberRowSchema = z
  .object({
    memberName: z.string().trim().min(1, "Member name is required"),
    phone: e164Phone,
    planName: z.string().trim().min(1, "Plan is required"),
    joinDate: z
      .iso.date("Invalid date format — use YYYY-MM-DD")
      .refine((val) => val <= todayIso(), {
        message: "Join date cannot be in the future",
      }),
    // Case-insensitive, matching plan_type's own case-insensitive matching
    // just below -- a manager typing "Active" shouldn't be rejected when
    // "Premium"/"premium" both resolve for plan_type in the same row.
    subscriptionStatus: z.preprocess(
      (val) => (typeof val === "string" ? val.trim().toLowerCase() : val),
      subscriptionStatusSchema,
    ),
    expiryDate: z.preprocess(
      blankToUndefined,
      z.iso.date("Invalid date format — use YYYY-MM-DD").optional().nullable(),
    ),
  })
  .refine((data) => data.expiryDate == null || data.expiryDate >= data.joinDate, {
    message: "Expiry date must be on or after the join date",
    path: ["expiryDate"],
  })
  // Mirrors createMemberSchema's own second refine: a pay-per-session row
  // leaves expiryDate null (checked against the resolved plan's type at
  // Task 3's DB-dependent layer, not here), which this refine skips -- when
  // an expiry date IS present, it must agree with the chosen status.
  .refine(
    (data) => {
      if (data.expiryDate == null) return true;
      const today = todayIso();
      // Mirrors createMemberSchema's identical fix (packages/types/src/
      // schemas/member.ts) -- grace_period means the expiry date has already
      // passed (FR-029), same direction as expired, not the opposite.
      return data.subscriptionStatus === "expired" || data.subscriptionStatus === "grace_period"
        ? data.expiryDate <= today
        : data.expiryDate >= today;
    },
    {
      message: "Subscription status doesn't match the expiry date",
      path: ["subscriptionStatus"],
    },
  );

export type CsvMemberRowInput = z.infer<typeof csvMemberRowSchema>;
