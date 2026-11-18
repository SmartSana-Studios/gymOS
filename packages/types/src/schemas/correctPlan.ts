import { z } from "zod";

// Story 27.4: validates the Server Actions of Correct plan (UX AD-31). `authCode` is the fresh authenticator code a GymOS Support
// session types (the action turns it into a single-use grant); it never reaches the database function.

/** The reason limits of the Correct plan modal and of correct_subscription_plan: 5 to 300 characters after trimming. */
export const CORRECT_PLAN_REASON_MIN_LENGTH = 5;
export const CORRECT_PLAN_REASON_MAX_LENGTH = 300;

/** The modal's opening check: one member id. */
export const correctPlanEligibilitySchema = z.object({
  memberId: z.uuid("Invalid member id"),
});

export type CorrectPlanEligibilityInput = z.infer<typeof correctPlanEligibilitySchema>;

/**
 * The correction. `subscriptionId` is the subscription the modal showed (its eligibility answer): the database refuses with
 * `subscription_changed` when a renewal landed meanwhile. It is optional only for callers that did not read one.
 */
export const correctPlanSchema = z.object({
  memberId: z.uuid("Invalid member id"),
  newPlanId: z.uuid("Invalid plan id"),
  subscriptionId: z.uuid("Invalid subscription id").optional(),
  reason: z
    .string()
    .trim()
    .min(CORRECT_PLAN_REASON_MIN_LENGTH, "Enter a reason")
    .max(CORRECT_PLAN_REASON_MAX_LENGTH, "The reason is too long"),
});

export type CorrectPlanInput = z.infer<typeof correctPlanSchema>;
