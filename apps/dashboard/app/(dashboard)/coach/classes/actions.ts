"use server";

import { type AppError } from "@gymos/types";
import { listMyClassSessionRoster, type CoachRosterRow } from "@/services/classes";

/** Story 17.4 (AC #8): the My Classes roster panel's lazy read, called each
 * time a session is expanded. A thin wrapper, same shape as the admin page's
 * getSessionBookingsAction (classes/actions.ts). Like every Server Action it
 * is a public endpoint callable with any id; `list_my_class_session_roster()`
 * is what decides, returning rows only for a session of the caller's own
 * class. This page has no write path, so this is its only action. */
export async function getMySessionRosterAction(
  classSessionId: string,
): Promise<{ data: CoachRosterRow[] | null; error: AppError | null }> {
  return listMyClassSessionRoster(classSessionId);
}
