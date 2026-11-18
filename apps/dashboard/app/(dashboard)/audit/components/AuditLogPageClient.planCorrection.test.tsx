/**
 * Story 27.4 (UX AD-12 V1.8): the Details cell of a subscription_plan_corrected row carries both plans, both prices, both expiries and the
 * reason in the one row, in the real EN and FR words. Metadata that is missing or unexpected falls back to the generic cell.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { realT } from "@/test-utils/realT";

let language: "en" | "fr" = "en";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: realT(language), i18n: { language } }),
}));
vi.mock("../actions", () => ({ exportAuditLogCsvAction: vi.fn() }));

import { AuditLogPageClient } from "./AuditLogPageClient";

function row(metadata: Record<string, unknown>) {
  return {
    id: "a",
    actorId: null,
    actorDisplayName: "Manager",
    actionType: "subscription_plan_corrected",
    targetEntityId: "m1",
    targetEntityType: "member",
    metadata,
    createdAt: "2026-11-18T10:00:00Z",
  };
}

function detailsOf(metadata: Record<string, unknown>) {
  const { container } = render(
    <AuditLogPageClient initialRows={[row(metadata)]} total={1} page={1} pageSize={50} from="" to="" actorId="" role="manager" actorOptions={[]} />,
  );
  const tr = container.querySelector("tbody tr");
  return { action: tr?.querySelectorAll("td")[2]?.textContent ?? "", details: (tr?.querySelectorAll("td")[4]?.textContent ?? "").replace(/[  ]/g, " ") };
}

const META = {
  old_plan_name: "Annual",
  new_plan_name: "Monthly",
  old_price: 250000,
  new_price: 25000,
  old_expiry_date: "2027-11-02",
  new_expiry_date: "2026-12-02",
  reason: "Wrong plan chosen at sign-up",
};

describe("audit Details of a plan correction", () => {
  it("EN: both plans, both prices, both expiries and the reason", () => {
    language = "en";
    const { action, details } = detailsOf(META);
    expect(action).toBe("Plan corrected");
    expect(details).toBe("Annual → Monthly · 250,000 → 25,000 XAF · expires 02 Nov 2027 → 02 Dec 2026 · Reason: Wrong plan chosen at sign-up");
  });

  it("FR", () => {
    language = "fr";
    const { action, details } = detailsOf(META);
    expect(action).toBe("Formule corrigée");
    expect(details).toBe("Annual → Monthly · 250 000 → 25 000 XAF · expire le 02 nov. 2027 → 02 déc. 2026 · Motif : Wrong plan chosen at sign-up");
  });

  it("a Pay-per-session side has no expiry", () => {
    language = "en";
    const { details } = detailsOf({ ...META, new_plan_name: "Drop-in", new_price: 2000, new_expiry_date: null });
    expect(details).toBe("Annual → Drop-in · 250,000 → 2,000 XAF · expires 02 Nov 2027 → no expiry · Reason: Wrong plan chosen at sign-up");
  });

  it("falls back to the generic cell when the metadata is incomplete", () => {
    language = "en";
    const { details } = detailsOf({ reason: "x" });
    expect(details).toBe("reason: x");
  });
});
