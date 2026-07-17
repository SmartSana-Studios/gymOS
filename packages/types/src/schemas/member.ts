import { z } from "zod";

// Story 2.3: Manager/Owner -- Create, Edit & Deactivate Members (FR-019-023).
//
// E.164 phone + REASON_MIN_LENGTH per-file consts, kept local per this
// project's established "no shared cross-file consts" convention (matches
// gym.ts/plan.ts/tier.ts's own precedent) -- gym.ts's exact e164Phone regex,
// redeclared here rather than imported.
const e164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");
const REASON_MIN_LENGTH = 5;

// AD-05's own field-validation rule: a member must be at least 10 years old.
const MIN_MEMBER_AGE_YEARS = 10;
// No AC/mockup specifies an upper bound, but an unbounded DOB accepts
// obviously-implausible values (e.g. the year 1900) with no feedback --
// 120 years comfortably exceeds any real member's age without risking a
// false rejection.
const MAX_MEMBER_AGE_YEARS = 120;

// Date-only string comparison throughout this file (never `new Date(val) <=
// new Date()`): an ISO "YYYY-MM-DD" string parses as UTC midnight, so
// comparing it against a full local `new Date()` instant can misclassify a
// same-day boundary value depending on the caller's timezone offset relative
// to UTC. Comparing two UTC-derived date-only strings sidesteps this --
// ISO-formatted dates sort lexicographically the same as chronologically.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export const subscriptionStatusSchema = z.enum([
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
]);

// Reused by both createMemberSchema and editMemberSchema below -- local
// reuse within this one file, not the cross-file sharing this project's
// per-schema-file convention avoids.
const dobSchema = z
  .iso
  .date("Enter a valid date")
  .optional()
  .nullable()
  .refine((val) => !val || val <= todayIso(), {
    message: "Date of birth must be in the past",
  })
  .refine((val) => !val || val <= isoDateYearsAgo(MIN_MEMBER_AGE_YEARS), {
    message: `Member must be at least ${MIN_MEMBER_AGE_YEARS} years old`,
  })
  .refine((val) => !val || val >= isoDateYearsAgo(MAX_MEMBER_AGE_YEARS), {
    message: "Enter a plausible date of birth",
  });

const nameSchema = z.string().trim().min(2, "Name is required").max(100, "Name is too long");
const emailSchema = z.email("Enter a valid email address").optional().nullable();
const photoUrlSchema = z.url("Enter a valid URL").max(2048, "URL is too long").optional().nullable();
const emergencyContactSchema = z.string().trim().max(200, "Emergency contact is too long").optional().nullable();

// AC #1: create a member with name/phone/plan (required) plus optional
// email/dob/photo/emergency contact. `expiryDate`'s presence/absence
// depends on the selected plan's `plan_type` (pay_per_session has no fixed
// expiry, Scope Note #2) -- this schema has no access to the plan row, so
// that half of the invariant is enforced at the Server Action layer
// (createMember, a second explicit runtime check), not here. This schema
// only enforces the invariant it CAN see: an expiry date, if provided, must
// not precede the join date.
export const createMemberSchema = z
  .object({
    name: nameSchema,
    phone: e164Phone,
    email: emailSchema,
    dob: dobSchema,
    photoUrl: photoUrlSchema,
    emergencyContact: emergencyContactSchema,
    planId: z.uuid("Select a plan"),
    joinDate: z
      .iso.date("Enter a valid join date")
      .refine((val) => val <= todayIso(), {
        message: "Join date cannot be in the future",
      }),
    subscriptionStatus: subscriptionStatusSchema,
    expiryDate: z.iso.date("Enter a valid expiry date").optional().nullable(),
  })
  .refine((data) => data.expiryDate == null || data.expiryDate >= data.joinDate, {
    message: "Expiry date must be on or after the join date",
    path: ["expiryDate"],
  })
  // A pay-per-session plan leaves expiryDate null (Scope Note #2), which
  // this refine deliberately skips -- there's nothing to contradict. When an
  // expiry date IS present, it must agree with the chosen status: "expired"
  // implies the expiry has already passed (or is today), while the three
  // still-valid statuses imply it hasn't yet -- otherwise a member could be
  // created already-expired with a future expiry date, or vice versa.
  .refine(
    (data) => {
      if (data.expiryDate == null) return true;
      const today = todayIso();
      // grace_period means the expiry date has already passed and the
      // member is in a post-expiry allowance window (FR-029: "grace period
      // begins the day after expiry") -- same direction as expired, not the
      // opposite (code review fix: this previously required a future expiry
      // date for grace_period, making it impossible to ever assign with the
      // past-expiry date the concept implies).
      return data.subscriptionStatus === "expired" || data.subscriptionStatus === "grace_period"
        ? data.expiryDate <= today
        : data.expiryDate >= today;
    },
    {
      message: "Subscription status doesn't match the expiry date",
      path: ["subscriptionStatus"],
    },
  );

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

// Edit-mode scope (story's own boundary): identity fields only. No phone
// (FR-023's "phone changes require admin intervention" -- a dedicated future
// story, since a phone change touches auth.users identity, not just this
// row) and no plan/joinDate/subscriptionStatus/expiryDate (renewal/
// lifecycle territory, Story 3.2's job).
export const editMemberSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  dob: dobSchema,
  photoUrl: photoUrlSchema,
  emergencyContact: emergencyContactSchema,
});

export type EditMemberInput = z.infer<typeof editMemberSchema>;

// AC #3: deactivation requires a mandatory reason, recorded in audit_log
// metadata (not a members/subscriptions column) -- same
// REASON_MIN_LENGTH = 5 convention as gym.ts's gymStatusChangeSchema,
// redeclared locally per that file's own established per-file-const
// precedent.
export const deactivateMemberSchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing this deactivation"),
});

export type DeactivateMemberInput = z.infer<typeof deactivateMemberSchema>;
