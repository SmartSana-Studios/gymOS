import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { groupCoachClassRows, type CoachClassRow, type CoachClassRpcRow, type CoachRosterRow } from "@/services/classes";
import type { SessionNoteRow } from "@/services/coaches";

/**
 * Story 29.4 (FR-247, AD-58): the Coach Portal's picker reads, for an Owner, Supervisor or Manager choosing one coach of their gym. Every read here is one of
 * the seven `rpc` calls of migration 0183 and nothing else: no `.from()`, no `auth.getClaims()`, no storage call, no write. The database is the authority
 * (live role, own gym, an active Coach-role member, a current assignment, allow-listed columns, no body or progress data); an empty result means "not
 * yours" and is never an error. A test renders the whole picker flow with a Supabase double that throws on anything but these seven RPCs.
 *
 * Deliberately NOT here, and never to be called in picker mode: `getMemberDetail()` (selects `starting_weight_kg`), `getWorkoutPlan()` (reads plan
 * completions), `listSessionNotes()` and `listAssignedMembers()` (RLS reads), and everything of `getMemberProgressData()`.
 */

export interface PickerCoach {
  id: string;
  name: string;
  /** False for a deactivated coach, kept in the list only so that a stale link can say "no longer a coach". The select lists the active ones. */
  isActive: boolean;
}

/** `list_picker_coaches()`: this gym's Coach-role members, by name. Empty for any caller who is not an Owner, Supervisor or Manager. Memoised per request:
 * the Portal layout and the page both ask. */
export const listPickerCoaches = cache(async (): Promise<{ data: PickerCoach[] | null; error: AppError | null }> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_picker_coaches");
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return {
    data: ((data ?? []) as { coach_id: string; coach_name: string; is_active: boolean }[]).map((row) => ({
      id: row.coach_id,
      name: row.coach_name,
      isActive: row.is_active,
    })),
    error: null,
  };
});

/** `list_coach_classes(p_coach_id)`: the chosen coach's classes with their sessions from 00:00 today in the gym's time zone, grouped as the Coach's own list. */
export async function listCoachClasses(coachId: string): Promise<{ data: CoachClassRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_coach_classes", { p_coach_id: coachId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: groupCoachClassRows((data ?? []) as CoachClassRpcRow[]), error: null };
}

/** `list_coach_class_session_roster(p_coach_id, p_class_session_id)`: who is booked into one session of the chosen coach's class: member, name, attendance. */
export async function listCoachClassSessionRoster(
  coachId: string,
  classSessionId: string,
): Promise<{ data: CoachRosterRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_coach_class_session_roster", {
    p_coach_id: coachId,
    p_class_session_id: classSessionId,
  });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return {
    data: ((data ?? []) as { member_id: string; member_name: string; attended_at: string | null }[]).map((row) => ({
      memberId: row.member_id,
      memberName: row.member_name,
      attendedAt: row.attended_at,
    })),
    error: null,
  };
}

export type PickerSubscriptionStatus = "active" | "expiring_soon" | "grace_period" | "expired";

/** One assigned member of the chosen coach: the allow-listed profile columns, the plan name and the subscription's status and expiry (null when the member
 * has no subscription). Nothing about the body, progress or contact beyond the phone. */
export interface PickerMemberRow {
  memberId: string;
  memberName: string;
  phone: string | null;
  photoUrl: string | null;
  goal: string | null;
  experienceLevel: string | null;
  status: PickerSubscriptionStatus | null;
  planName: string | null;
  expiryDate: string | null;
  joinDate: string;
  /** The latest note of the chosen coach, clipped; the list only. */
  lastNoteSnippet?: string | null;
}

interface PickerMemberFromDb {
  member_id: string;
  member_name: string;
  phone: string | null;
  photo_url: string | null;
  goal: string | null;
  experience_level: string | null;
  status: PickerSubscriptionStatus | null;
  plan_name: string | null;
  expiry_date: string | null;
  join_date: string;
  last_note_snippet?: string | null;
}

function toPickerMemberRow(row: PickerMemberFromDb): PickerMemberRow {
  return {
    memberId: row.member_id,
    memberName: row.member_name,
    phone: row.phone,
    photoUrl: row.photo_url,
    goal: row.goal,
    experienceLevel: row.experience_level,
    status: row.status,
    planName: row.plan_name,
    expiryDate: row.expiry_date,
    joinDate: row.join_date,
    ...(row.last_note_snippet !== undefined ? { lastNoteSnippet: row.last_note_snippet } : {}),
  };
}

const SORTERS: Record<string, (a: PickerMemberRow) => string> = {
  name: (a) => a.memberName,
  plan: (a) => a.planName ?? "",
  status: (a) => a.status ?? "",
  expiry: (a) => a.expiryDate ?? "",
};

/** `list_coach_assigned_members(p_coach_id)`: the chosen coach's currently assigned members. The list is a caseload (200 at most in the scale test, well under
 * the API's 1000-row cap), so the AD-14 search and sort are applied here, as the coach's own list does through the API. */
export async function listCoachAssignedMembers(
  coachId: string,
  params: { search?: string; sort?: string; dir?: string } = {},
): Promise<{ data: PickerMemberRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_coach_assigned_members", { p_coach_id: coachId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  let rows = ((data ?? []) as PickerMemberFromDb[]).map(toPickerMemberRow);
  const term = typeof params.search === "string" ? params.search.trim().toLowerCase() : "";
  if (term) rows = rows.filter((row) => row.memberName.toLowerCase().includes(term));

  const key = typeof params.sort === "string" && Object.hasOwn(SORTERS, params.sort) ? SORTERS[params.sort] : SORTERS.name;
  const direction = params.dir === "desc" ? -1 : 1;
  rows = [...rows].sort((a, b) => direction * key(a).localeCompare(key(b)) || a.memberName.localeCompare(b.memberName));

  return { data: rows, error: null };
}

/** `get_coach_assigned_member(p_coach_id, p_member_id)`: the one-member header, or null when the member is not currently assigned to that coach (or the coach is
 * not available): the page then shows "not assigned" and never the profile. */
export async function getCoachAssignedMember(
  coachId: string,
  memberId: string,
): Promise<{ data: PickerMemberRow | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_coach_assigned_member", { p_coach_id: coachId, p_member_id: memberId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  const row = ((data ?? []) as PickerMemberFromDb[])[0];
  return { data: row ? toPickerMemberRow(row) : null, error: null };
}

/** `list_coach_member_session_notes(p_coach_id, p_member_id)`: the chosen coach's own notes on the member, newest first, with author and time. */
export async function listCoachMemberSessionNotes(
  coachId: string,
  memberId: string,
): Promise<{ data: SessionNoteRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_coach_member_session_notes", { p_coach_id: coachId, p_member_id: memberId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return {
    data: (
      (data ?? []) as { note_id: string; coach_id: string; coach_name: string; note_text: string; created_at: string; edited_at: string | null }[]
    ).map((row) => ({
      id: row.note_id,
      coachId: row.coach_id,
      coachName: row.coach_name,
      noteText: row.note_text,
      createdAt: row.created_at,
      editedAt: row.edited_at,
    })),
    error: null,
  };
}

export interface PickerWorkoutExercise {
  id: string;
  orderIndex: number;
  exerciseName: string;
  sets: number;
  reps: number;
  note: string | null;
}

/** The member's workout plan as authored: ordered exercises and the author. No completion data of any kind. */
export interface PickerWorkoutPlan {
  planId: string;
  planName: string;
  authorId: string | null;
  authorName: string | null;
  exercises: PickerWorkoutExercise[];
}

/** `get_coach_member_workout_plan(p_coach_id, p_member_id)`: one row per exercise, or one row with null exercise columns for a plan with none; null for no plan. */
export async function getCoachMemberWorkoutPlan(
  coachId: string,
  memberId: string,
): Promise<{ data: PickerWorkoutPlan | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_coach_member_workout_plan", { p_coach_id: coachId, p_member_id: memberId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  const rows = (data ?? []) as {
    plan_id: string;
    plan_name: string;
    author_id: string | null;
    author_name: string | null;
    plan_exercise_id: string | null;
    order_index: number | null;
    exercise_name: string | null;
    sets: number | null;
    reps: number | null;
    note: string | null;
  }[];
  if (rows.length === 0) {
    return { data: null, error: null };
  }
  const first = rows[0];
  return {
    data: {
      planId: first.plan_id,
      planName: first.plan_name,
      authorId: first.author_id,
      authorName: first.author_name,
      exercises: rows
        .filter((row) => row.plan_exercise_id !== null && row.exercise_name !== null)
        .map((row) => ({
          id: row.plan_exercise_id as string,
          orderIndex: Number(row.order_index),
          exerciseName: row.exercise_name as string,
          sets: Number(row.sets),
          reps: Number(row.reps),
          note: row.note,
        })),
    },
    error: null,
  };
}
