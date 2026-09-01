import { existsSync, readFileSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "../helpers/env";
import { FIXTURES_FILE_PATH, type FixtureData } from "./types";

/**
 * Runs whether the suite passed or failed (Playwright always invokes
 * `globalTeardown` after the run), matching this project's own "throwaway
 * fixture, cleaned up afterward" discipline (docs/decisions.md's Story
 * 4.10/4.13 spike sessions). None of `gym_id`'s referencing tables cascade
 * on delete in this schema (confirmed via grep across every migration) --
 * every gym-scoped table is deleted explicitly here, in FK-safe order,
 * before the gym row itself; `members.user_id` is the one real
 * `on delete cascade` in this chain, but the explicit member deletes below
 * still run first since several tables reference `members(id)` directly
 * without cascade.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURES_FILE_PATH)) return;
  const fixtures: FixtureData = JSON.parse(readFileSync(FIXTURES_FILE_PATH, "utf-8"));

  const admin = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const memberIds = [
    fixtures.member.memberId,
    ...fixtures.classFillerMembers.map((m) => m.memberId),
    fixtures.owner.memberId,
    fixtures.supervisor.memberId,
    fixtures.manager.memberId,
    fixtures.coach.memberId,
    fixtures.secondCoach.memberId,
  ];
  const userIds = [
    fixtures.member.userId,
    ...fixtures.classFillerMembers.map((m) => m.userId),
    fixtures.owner.userId,
    fixtures.supervisor.userId,
    fixtures.manager.userId,
    fixtures.coach.userId,
    fixtures.secondCoach.userId,
  ];

  // Every step logs rather than throws on error -- a single failed delete
  // (FK surprise, transient network blip) must not abort the rest of
  // teardown, since each later step is independently useful cleanup even if
  // an earlier one failed, and the fixtures file must still be removed so a
  // stuck teardown doesn't block every subsequent run's globalSetup.
  async function tryDelete(label: string, op: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await op;
    if (error) {
      console.error(`e2e teardown: ${label} failed -- ${error.message}`);
    }
  }

  await tryDelete("payments delete", admin.from("payments").delete().eq("gym_id", fixtures.gymId));
  await tryDelete("class_bookings delete", admin.from("class_bookings").delete().eq("class_session_id", fixtures.classSessionId));
  await tryDelete("progress_photos delete", admin.from("progress_photos").delete().in("member_id", memberIds));
  await tryDelete("progress_entries delete", admin.from("progress_entries").delete().in("member_id", memberIds));
  await tryDelete("coach_assignments delete", admin.from("coach_assignments").delete().in("member_id", memberIds));
  await tryDelete("subscriptions delete", admin.from("subscriptions").delete().in("member_id", memberIds));
  await tryDelete("class_sessions delete", admin.from("class_sessions").delete().eq("id", fixtures.classSessionId));
  await tryDelete("classes delete", admin.from("classes").delete().eq("id", fixtures.classId));
  await tryDelete("gym_payment_credentials delete", admin.from("gym_payment_credentials").delete().eq("gym_id", fixtures.gymId));
  await tryDelete("members delete", admin.from("members").delete().eq("gym_id", fixtures.gymId));
  await tryDelete("plans delete", admin.from("plans").delete().eq("id", fixtures.planId));
  await tryDelete("gyms delete", admin.from("gyms").delete().eq("id", fixtures.gymId));

  for (const userId of userIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (e) {
      console.error(`e2e teardown: deleteUser(${userId}) failed --`, e);
    }
  }

  rmSync(FIXTURES_FILE_PATH, { force: true });
}
