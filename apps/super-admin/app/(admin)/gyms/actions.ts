"use server";

import { createGymSchema, type AppError } from "@gymos/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteGym,
  gymNameExists,
  insertGym,
  insertOwnerMember,
  logGymCreated,
  mapAndLog,
} from "@/services/gyms";

export interface CreateGymResult {
  gymId: string;
  ownerPhone: string;
  /**
   * True once a real SMS provider is wired in (Story 2.1+). Always false for
   * now -- sendInviteSms is a stub (Open Question 3). The client uses this
   * to show honest copy instead of unconditionally claiming "SMS sent"
   * (code review finding: the toast previously lied about delivery).
   */
  smsSent: boolean;
}

/**
 * SA-04 Create Gym. Never throws for expected errors -- returns
 * `{ data, error }` per architecture's Process Patterns. See story 1-5's Dev
 * Notes for the full sequencing rationale (compensating cleanup on partial
 * failure, why the admin client is scoped to exactly one call, the SMS-stub
 * decision).
 */
export async function createGym(
  input: unknown,
): Promise<{ data: CreateGymResult | null; error: AppError | null }> {
  const parsed = createGymSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? "Invalid input" },
    };
  }
  const gym = parsed.data;

  // Step 1: fast-fail pre-check (real guarantee is the DB unique index).
  if (await gymNameExists(gym.gymName)) {
    return {
      data: null,
      error: { code: "gym_name_taken", message: "A gym with this name already exists" },
    };
  }

  // Step 2: insert the gym.
  const { data: gymRow, error: gymError } = await insertGym({
    name: gym.gymName,
    tierId: gym.tierId,
    status: gym.status,
  });
  if (gymError || !gymRow) {
    return { data: null, error: gymError };
  }

  // Step 3: create the owner's auth.users account (admin client -- the only
  // step in this flow that structurally requires it). Both email and phone
  // are set: email is the Supabase Auth login identifier (matching AD-01/
  // SA-01's existing signInWithPassword({ email, password }) form), phone is
  // stored for display (SA-03's "Owner: Paul Nkusu (+237 6XX XXX XXX)"). A
  // random password is set and never surfaced directly -- delivery is via a
  // generated recovery link (Step 4), not a plaintext password over SMS.
  //
  // createAdminClient() itself (env var non-null assertions) and the first
  // admin call are wrapped together: a misconfigured deployment throwing
  // here must still trigger the same compensating cleanup as every other
  // failure branch, not bypass it via an uncaught exception (code review
  // finding -- this was previously unguarded, after the gym row already
  // existed). An IIFE keeps the try/catch's inferred success type flowing
  // naturally into `admin`/`authUser` below, instead of hand-writing their
  // (fairly gnarly) generic types.
  const provisioned = await (async () => {
    try {
      const admin = createAdminClient();
      const temporaryPassword = crypto.randomUUID();
      const { data, error: authError } = await admin.auth.admin.createUser({
        email: gym.ownerEmail,
        phone: gym.ownerPhone,
        password: temporaryPassword,
        email_confirm: true,
        phone_confirm: true,
      });

      if (authError || !data?.user) {
        return { ok: false as const, error: mapAndLog(authError) };
      }
      return { ok: true as const, admin, authUser: data };
    } catch (err) {
      return { ok: false as const, error: mapAndLog(err) };
    }
  })();

  if (!provisioned.ok) {
    await deleteGym(gymRow.id); // compensating cleanup: no orphaned gym
    return { data: null, error: provisioned.error };
  }
  const { admin, authUser } = provisioned;

  // Step 4: generate a password-recovery link for the SMS invite (Step 6) --
  // does not send Supabase's own built-in email; this flow's delivery
  // channel is SMS (AC #1, SA-04's toast copy).
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: gym.ownerEmail,
  });

  if (linkError || !linkData) {
    await deleteGym(gymRow.id);
    await deleteAuthUserAndLog(admin, authUser.user.id);
    return { data: null, error: mapAndLog(linkError) };
  }

  // Step 5: insert the owner's membership row.
  const { error: memberError } = await insertOwnerMember({
    gymId: gymRow.id,
    userId: authUser.user.id,
    name: gym.ownerName,
    phone: gym.ownerPhone,
  });

  if (memberError) {
    // Two-deep compensating cleanup: gym and the just-created auth user.
    await deleteGym(gymRow.id);
    await deleteAuthUserAndLog(admin, authUser.user.id);
    return { data: null, error: memberError };
  }

  // Step 6: send the invite SMS -- stub for this story (Open Question 3, no
  // sandbox-verified SMS provider yet). Failure here must NOT roll back the
  // already-successful gym/owner/member creation.
  const smsSent = await sendInviteSms(gym.ownerPhone, linkData.properties.action_link);

  // Step 7: audit log entry -- the natural first entry in a gym's trail.
  await logGymCreated(gymRow.id, {
    owner_name: gym.ownerName,
    owner_phone: gym.ownerPhone,
    tier_id: gym.tierId,
    sms_sent: smsSent,
  });

  return { data: { gymId: gymRow.id, ownerPhone: gym.ownerPhone, smsSent }, error: null };
}

/** Compensating-cleanup helper: deleteUser()'s own result was previously
 * unchecked -- if it fails, an orphaned auth.users row would be left with
 * no trace (code review finding). Logs, does not throw. */
async function deleteAuthUserAndLog(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[createGym] compensating cleanup failed to delete auth user ${userId}`,
      error,
    );
  }
}

/**
 * Story 1.5 Open Question 3's recommended default: no SMS provider is
 * sandbox-verified yet (Story 2.1, Epic 2, still backlog). Rather than ship
 * unverified real SMS delivery in Epic 1, this records the invite instead of
 * sending it -- swap for a real TwilioSmsProvider-backed implementation once
 * Story 2.1 lands. Deliberately never throws. Returns false (never actually
 * sent) so the caller can show honest UI copy instead of claiming delivery.
 */
async function sendInviteSms(phone: string, actionLink: string): Promise<boolean> {
  console.info(
    `[invite-sms-stub] Would send SMS to ${phone} with login link: ${actionLink}`,
  );
  return false;
}
