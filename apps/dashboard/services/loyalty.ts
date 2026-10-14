import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";

/** Story 20.5: what the member modal's Rewards section shows (AD-04). */
export interface MemberLoyalty {
  enabled: boolean;
  guestStamps: number;
  subscriberStamps: number;
  guestThreshold: number | null;
  renewalThreshold: number | null;
  freeSessions: { id: string; usableUntil: string }[];
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asThreshold(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Parses `effective_loyalty()`'s JSON. JSON null (a suspended gym) or any
 * non-object is `null`: the section is left out rather than guessed at. */
export function parseEffectiveLoyalty(raw: unknown): MemberLoyalty | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") return null;

  const freeRaw = Array.isArray(row.free_sessions) ? row.free_sessions : [];
  const freeSessions: MemberLoyalty["freeSessions"] = [];
  for (const entry of freeRaw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, usable_until: usableUntil } = entry as Record<string, unknown>;
    if (typeof id === "string" && typeof usableUntil === "string") {
      freeSessions.push({ id, usableUntil });
    }
  }

  return {
    enabled: row.enabled,
    guestStamps: asCount(row.guest_stamps),
    subscriberStamps: asCount(row.subscriber_stamps),
    guestThreshold: asThreshold(row.guest_threshold),
    renewalThreshold: asThreshold(row.renewal_threshold),
    freeSessions,
  };
}

/** Story 20.5 (FR-169): the only read source for a member's loyalty state,
 * `effective_loyalty()` (0117). It never writes; role and gym are enforced
 * inside the RPC. `data: null` with no error means "leave the section out". */
export async function getMemberLoyalty(
  memberId: string,
): Promise<{ data: MemberLoyalty | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("effective_loyalty", { p_member_id: memberId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: parseEffectiveLoyalty(data), error: null };
}
