"use server";

import { type AppError } from "@gymos/types";
import { type CoachRosterRow } from "@/services/classes";
import { listCoachClassSessionRoster } from "@/services/coachPicker";

/** Story 29.4: the picker's Classes tab roster read, called each time a session is expanded. A thin, READ-ONLY wrapper: the one action of the picker's routes,
 * and no write exists beside it. Like every Server Action it is a public endpoint callable with any ids; `list_coach_class_session_roster()` decides, and
 * returns rows only for a caller who is an Owner, Supervisor or Manager of the gym, for an active coach of that gym, and a session of that coach's class from
 * 00:00 today on. */
export async function getCoachSessionRosterAction(
  coachId: string,
  classSessionId: string,
): Promise<{ data: CoachRosterRow[] | null; error: AppError | null }> {
  return listCoachClassSessionRoster(coachId, classSessionId);
}
