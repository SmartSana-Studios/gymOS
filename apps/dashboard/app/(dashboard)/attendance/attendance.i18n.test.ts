/**
 * Story 27.3: every string of the Check in a member modal (AD-30 R1 to R12), the Entry column, the Void modal (AD-11 V1.8) and the
 * "Desk check-in" source of the Guest sessions blocked attempts exists in English and French, and the French is not the English copied.
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}
function leaves(node: unknown, prefix: string): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`));
}

describe("attendance strings (27.3)", () => {
  const keys = [...leaves((en as { attendance: { checkIn: unknown } }).attendance.checkIn, "attendance.checkIn"),
    ...leaves((en as { attendance: { void: unknown } }).attendance.void, "attendance.void"),
    ...leaves((en as { attendance: { log: unknown } }).attendance.log, "attendance.log"),
    "guestSessions.source.desk", "attendance.table.entry"];

  it("has every key in both locales", () => {
    for (const key of keys) {
      expect(typeof resolve(en, key), `en ${key}`).toBe("string");
      expect(typeof resolve(fr, key), `fr ${key}`).toBe("string");
    }
  });

  it("uses the UX copy for the desk source and the three pills", () => {
    expect(resolve(en, "guestSessions.source.desk")).toBe("Desk check-in");
    expect(resolve(fr, "guestSessions.source.desk")).toBe("Arrivée à l'accueil");
    expect(resolve(en, "attendance.log.byStaff")).toBe("By staff");
    expect(resolve(fr, "attendance.log.byStaff")).toBe("Par le personnel");
    expect(resolve(fr, "attendance.log.voided")).toBe("Annulée");
  });

  it("translates the long strings (French differs from English)", () => {
    for (const key of ["attendance.checkIn.ok", "attendance.checkIn.partialSession", "attendance.void.body", "attendance.void.refused.laterVisit", "attendance.checkIn.offline"]) {
      expect(resolve(fr, key)).not.toBe(resolve(en, key));
    }
  });
});
