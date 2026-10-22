export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function reasonValid(reason: string): boolean {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
}

export const EMPTY_CELL = "—";

export type SupportMessage = { kind: "ok" | "error"; text: string };
