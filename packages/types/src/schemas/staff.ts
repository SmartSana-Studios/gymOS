import { z } from "zod";

// Story 9.1: Staff Creation with Role-Ceiling Enforcement (FR-087/FR-089).
//
// E.164 phone regex redeclared here rather than imported -- matches
// member.ts/gym.ts/payment.ts's own per-file "no shared cross-file consts"
// precedent.
const e164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");

// Never "owner" -- no caller of create_staff_member() can ever target it
// (the RPC's own allowlist rejects it unconditionally, AC #4), so it isn't
// offered at the schema level either. The Add Staff modal further narrows
// this client-side to the acting user's own ceiling (Owner sees
// supervisor/manager/receptionist/coach; Supervisor sees only
// manager/receptionist/coach) -- that narrowing is a UX convenience, not the
// enforcement boundary; the RPC's own allowlist is what actually rejects a
// stale/bypassed client.
export const staffRoleSchema = z.enum(["supervisor", "manager", "receptionist", "coach"]);

export const createStaffMemberSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100, "Name is too long"),
  phone: e164Phone,
  role: staffRoleSchema,
});

export type CreateStaffMemberInput = z.infer<typeof createStaffMemberSchema>;

// Story 9.3 (AC #1/#2): Edit Staff. Name+Role only -- no phone (Task 13's
// decision: phone is the account's login identity, out of this story's
// scope, FR-089's own text names only "name and role"). Same name-copy as
// createStaffMemberSchema so both forms share identical field-level error
// text.
export const updateStaffRoleSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100, "Name is too long"),
  role: staffRoleSchema,
});

export type UpdateStaffRoleInput = z.infer<typeof updateStaffRoleSchema>;

// Story 9.3 (AC #3): mirrors deactivateMemberSchema's exact shape/copy
// (packages/types/src/schemas/member.ts:162-164) -- a deliberate
// near-duplicate rather than a shared cross-file import, matching this
// file's own established per-file-const precedent (line 6-7).
const STAFF_REASON_MIN_LENGTH = 5;

export const deactivateStaffSchema = z.object({
  reason: z.string().trim().min(STAFF_REASON_MIN_LENGTH, "Add a reason describing this deactivation"),
});

export type DeactivateStaffInput = z.infer<typeof deactivateStaffSchema>;
