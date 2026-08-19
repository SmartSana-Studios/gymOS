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
