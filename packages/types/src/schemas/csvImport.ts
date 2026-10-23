import { z } from "zod";

import { birthYearSchema, profileTextSchema, subscriptionStatusSchema } from "./member";

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
  "birth_year",
  "profession",
  "neighborhood",
] as const;

// Story 26.2: the only columns a file must have; every other column is
// optional (absent or blank).
export const CSV_REQUIRED_COLUMNS = ["member_name", "phone"] as const;

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
    // Blank means "no plan": the row creates a member awaiting the fee.
    planName: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1, "Plan is required").optional(),
    ),
    joinDate: z.preprocess(
      blankToUndefined,
      z
        .iso.date("Invalid date format — use YYYY-MM-DD")
        .refine((val) => val <= todayIso(), {
          message: "Join date cannot be in the future",
        })
        .optional(),
    ),
    // Case-insensitive, matching plan_type's own case-insensitive matching
    // just below -- a manager typing "Active" shouldn't be rejected when
    // "Premium"/"premium" both resolve for plan_type in the same row.
    subscriptionStatus: z.preprocess((val) => {
      const blank = blankToUndefined(val);
      return typeof blank === "string" ? blank.trim().toLowerCase() : blank;
    }, subscriptionStatusSchema.optional()),
    expiryDate: z.preprocess(
      blankToUndefined,
      z.iso.date("Invalid date format — use YYYY-MM-DD").optional().nullable(),
    ),
    // Story 26.2: optional profile facts, same schemas as Story 26.1. A CSV
    // cell is text, so a birth year is converted to a number first.
    birthYear: z.preprocess((val) => {
      const blank = blankToUndefined(val);
      if (typeof blank !== "string") return blank;
      const trimmed = blank.trim();
      return /^\d{4}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    }, birthYearSchema),
    profession: profileTextSchema,
    neighborhood: profileTextSchema,
  })
  .superRefine((data, ctx) => {
    if (data.planName === undefined) {
      // No plan: status and expiry mean nothing without one.
      if (data.subscriptionStatus !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["subscriptionStatus"],
          message: "A plan is required when a subscription status is given",
        });
      }
      if (data.expiryDate != null) {
        ctx.addIssue({
          code: "custom",
          path: ["expiryDate"],
          message: "A plan is required when an expiry date is given",
        });
      }
      return;
    }
    // A row with a plan follows the plan import's rules exactly.
    if (data.joinDate === undefined) {
      ctx.addIssue({ code: "custom", path: ["joinDate"], message: "Invalid date format — use YYYY-MM-DD" });
    }
    if (data.subscriptionStatus === undefined) {
      ctx.addIssue({ code: "custom", path: ["subscriptionStatus"], message: "Select a subscription status" });
    }
    if (data.joinDate !== undefined && data.expiryDate != null && data.expiryDate < data.joinDate) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "Expiry date must be on or after the join date",
      });
    }
    // Mirrors createMemberSchema's own second refine: a pay-per-session row
    // leaves expiryDate null (checked against the resolved plan's type at the
    // DB-dependent layer), which this skips -- when an expiry date IS
    // present, it must agree with the chosen status. grace_period means the
    // expiry has already passed (FR-029), same direction as expired.
    if (data.expiryDate != null && data.subscriptionStatus !== undefined) {
      const today = todayIso();
      const ok =
        data.subscriptionStatus === "expired" || data.subscriptionStatus === "grace_period"
          ? data.expiryDate <= today
          : data.expiryDate >= today;
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          path: ["subscriptionStatus"],
          message: "Subscription status doesn't match the expiry date",
        });
      }
    }
  });

export type CsvMemberRowInput = z.infer<typeof csvMemberRowSchema>;
