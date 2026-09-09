/**
 * Story 11.8 (Task 2, AC #4): mapSupabaseError()'s gym_suspended branch.
 *
 * 0090_suspension_enforcement_in_rpcs.sql gives all 18 gated write-RPCs the
 * same raise shape -- `<function_name>: gym <uuid> is not active` -- so one
 * mapping serves all of them. The assertions that matter here are the negative
 * ones: FR-132 and EXPERIENCE.md's Error States table forbid ever telling a
 * member that their gym owes money, so the copy must not leak billing wording,
 * and the branch must not swallow unrelated RPC errors that happen to mention
 * a gym.
 *
 * packages/types has no test runner of its own (no test script, no test
 * files), and mapSupabaseError is already exercised from this app -- see
 * services/staff.createStaffMember.test.ts and
 * services/session.switchActiveGym.test.ts -- so this lives here too.
 */
import { describe, expect, it } from "vitest";
import { isGymSuspendedError, mapSupabaseError } from "@gymos/types";

const GYM = "00000000-0000-0000-0000-000000009911";

// Every function 0090 gates, with the exact message each one raises.
const GATED_RPCS = [
  "check_in",
  "check_out",
  "check_out_member",
  "confirm_renewal",
  "renew_subscription",
  "initiate_member_payment",
  "create_staff_member",
  "update_staff_role",
  "deactivate_staff_member",
  "create_class",
  "update_class",
  "materialize_class_sessions",
  "book_class_session",
  "cancel_class_booking",
  "mark_class_attendance",
  "assign_coach",
  "add_session_note",
  "edit_session_note",
];

describe("mapSupabaseError -- gym_suspended (Story 11.8)", () => {
  it.each(GATED_RPCS)("maps %s's suspension raise to gym_suspended", (fn) => {
    const result = mapSupabaseError({ message: `${fn}: gym ${GYM} is not active` });

    expect(result.code).toBe("gym_suspended");
    expect(result.message).toBe(
      "GymOS is temporarily unavailable for this gym. Please check back later.",
    );
  });

  it("returns the French copy for locale fr", () => {
    const result = mapSupabaseError({ message: `check_in: gym ${GYM} is not active` }, "fr");

    expect(result.code).toBe("gym_suspended");
    expect(result.message).toBe(
      "GymOS est temporairement indisponible pour cette salle. Veuillez réessayer plus tard.",
    );
  });

  // FR-132: the member must never learn that this is about money. A suspension
  // is always caused by an unpaid GymOS invoice, but that relationship is
  // between GymOS and the Owner alone.
  it.each(["en", "fr"] as const)("never mentions billing to a member (%s)", (locale) => {
    const { message } = mapSupabaseError(
      { message: `book_class_session: gym ${GYM} is not active` },
      locale,
    );

    for (const forbidden of [
      "bill",
      "pay",
      "payment",
      "paie",
      "subscription",
      "abonnement",
      "overdue",
      "owed",
      "impay",
      "XAF",
    ]) {
      expect(message.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  // The branch keys on two substrings rather than a function-name prefix, so
  // it is worth proving it does not over-reach. Each of these mentions a gym
  // or the words "not active" without being a suspension raise.
  it.each([
    ["switch_active_gym: caller has no active membership at target gym", "gym_switch_not_permitted"],
    ["renew_subscription: member not found", "member_not_found"],
    ["check_out_member: member has no open check-in", "no_open_check_in"],
    ["some_rpc: the gym is fine", "unknown"],
    ["a plan is not active", "unknown"],
  ])("does not claim %s", (message, expectedCode) => {
    expect(mapSupabaseError({ message }).code).toBe(expectedCode);
  });

  // Code review 2026-09-09: every negative case above misses on ": gym " OR on
  // "is not active", never on a string carrying BOTH -- so the "does not
  // over-reach" claim was never actually exercised against a real near-miss.
  // This is the shape that would collide: a raise that mentions a gym uuid and
  // an inactive *something else*. It is a genuine limitation of substring
  // matching, and pinning it here means a future raise of this shape is a
  // deliberate choice rather than a silent mis-mapping.
  it("over-reaches on a raise carrying both substrings about a different subject", () => {
    const collision = "assign_coach: gym 0000-1111 has a plan that is not active";
    expect(mapSupabaseError({ message: collision }).code).toBe("gym_suspended");
  });

  // The load-bearing phrase itself. suspension_rpc_coverage.test.sql asserts
  // the SQL side (every guarded function raises a message containing
  // "is not active"); this is the TypeScript side of the same contract. If
  // someone rewords 0090s raise, one of the two fails.
  it("matches the exact raise shape 0090 emits, for every gated function name", () => {
    for (const fn of ["check_in", "check_out", "book_class_session", "initiate_member_payment", "update_staff_role"]) {
      const raise = fn + ": gym 00000000-0000-0000-0000-000000009911 is not active";
      expect(isGymSuspendedError({ message: raise })).toBe(true);
      expect(mapSupabaseError({ message: raise }).code).toBe("gym_suspended");
    }
  });
});
