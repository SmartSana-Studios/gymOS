import { z } from "zod";

// Story 27.3: validates the two Server Actions of the staff check-in and the same-day void. `authCode` is the fresh authenticator
// code a GymOS Support session types (the action turns it into a single-use grant); it never reaches the database function.

/** The Check in a member modal's confirm: one member id. There is deliberately no time, date or scan id (FR-248). */
export const staffCheckInSchema = z.object({
  memberId: z.uuid("Invalid member id"),
});

export type StaffCheckInInput = z.infer<typeof staffCheckInSchema>;

/** The reason limits of the Void modal and of void_staff_check_in: 5 to 300 characters after trimming. */
export const VOID_REASON_MIN_LENGTH = 5;
export const VOID_REASON_MAX_LENGTH = 300;

export const voidStaffCheckInSchema = z.object({
  attendanceId: z.uuid("Invalid attendance id"),
  reason: z.string().trim().min(VOID_REASON_MIN_LENGTH, "Enter a reason").max(VOID_REASON_MAX_LENGTH, "The reason is too long"),
});

export type VoidStaffCheckInInput = z.infer<typeof voidStaffCheckInSchema>;
