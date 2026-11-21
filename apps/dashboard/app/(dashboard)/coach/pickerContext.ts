import { getDashboardShellContext, type MemberRole } from "@/services/session";
import { listPickerCoaches, type PickerCoach } from "@/services/coachPicker";

/**
 * Story 29.4 (UX AD-32): what the Coach Portal shows for the caller, resolved on the server in each page (a layout cannot see search params).
 *
 * The shell role (the claim) only chooses the screen; every read behind it re-checks the live role in the database (AD-34). `own` is the Coach's portal
 * exactly as before: no picker, no banner, a typed `?coach=` never read (the Coach's own reads take no id). A Receptionist or GymOS Support never reaches a
 * page here: coach/layout.tsx shows them the permission message instead of the page.
 */
export const PICKER_ROLES: readonly MemberRole[] = ["owner", "supervisor", "manager"];

export type PickerContext =
  | { kind: "own" }
  | { kind: "error" }
  | { kind: "no-coaches"; canOpenStaff: boolean }
  | { kind: "choose" }
  | { kind: "single"; coachId: string }
  | { kind: "unavailable" }
  | { kind: "inactive"; name: string }
  | { kind: "ready"; coach: { id: string; name: string }; coaches: PickerCoach[] };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `?coach=` value as one string, or null when it is absent, repeated or not a uuid (a malformed value is "not available", never sent to the database). */
export function readCoachParam(raw: string | string[] | undefined): string | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) return "invalid";
  return raw.toLowerCase();
}

export async function resolvePicker(rawCoachParam: string | string[] | undefined): Promise<PickerContext> {
  const { data: shell } = await getDashboardShellContext();
  const role = shell?.role;
  if (!role || !PICKER_ROLES.includes(role)) {
    return { kind: "own" };
  }

  const { data: coaches, error } = await listPickerCoaches();
  if (error || !coaches) {
    return { kind: "error" };
  }

  const active = coaches.filter((coach) => coach.isActive);
  const requested = readCoachParam(rawCoachParam);
  const canOpenStaff = role === "owner" || role === "supervisor";

  if (requested === null) {
    if (active.length === 0) return { kind: "no-coaches", canOpenStaff };
    if (active.length === 1) return { kind: "single", coachId: active[0].id };
    return { kind: "choose" };
  }

  // A coach named in the address that this gym does not list (another gym's, not a coach, a random id, a malformed one) is "not available", whether or not
  // the gym has coaches of its own: the answer never depends on what exists elsewhere.
  const chosen = requested === "invalid" ? undefined : coaches.find((coach) => coach.id.toLowerCase() === requested);
  if (!chosen) return { kind: "unavailable" };
  if (!chosen.isActive) return { kind: "inactive", name: chosen.name };
  return { kind: "ready", coach: { id: chosen.id, name: chosen.name }, coaches: active };
}
