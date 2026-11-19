/**
 * Story 28.1 (UX AD-13 V1.8): the Details cell of a session_validity_changed row reads "Whole day → Single use", in the real EN and FR
 * words. Metadata that is missing or unexpected falls back to the generic cell.
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
    actorDisplayName: "Owner",
    actionType: "session_validity_changed",
    targetEntityId: "g1",
    targetEntityType: "gym",
    metadata,
    createdAt: "2026-11-19T10:00:00Z",
  };
}

function cellsOf(metadata: Record<string, unknown>) {
  const { container } = render(
    <AuditLogPageClient initialRows={[row(metadata)]} total={1} page={1} pageSize={50} from="" to="" actorId="" role="owner" actorOptions={[]} />,
  );
  const tr = container.querySelector("tbody tr");
  return { action: tr?.querySelectorAll("td")[2]?.textContent ?? "", details: tr?.querySelectorAll("td")[4]?.textContent ?? "" };
}

describe("audit Details of a session validity change", () => {
  it("EN: Whole day → Single use", () => {
    language = "en";
    const { action, details } = cellsOf({ old_validity: "whole_day", new_validity: "single_use" });
    expect(action).toBe("Session validity changed");
    expect(details).toBe("Whole day → Single use");
  });

  it("EN: the other direction", () => {
    language = "en";
    expect(cellsOf({ old_validity: "single_use", new_validity: "whole_day" }).details).toBe("Single use → Whole day");
  });

  it("FR", () => {
    language = "fr";
    const { action, details } = cellsOf({ old_validity: "whole_day", new_validity: "single_use" });
    expect(action).toBe("Validité de la séance modifiée");
    expect(details).toBe("Toute la journée → Usage unique");
  });

  it("falls back to the generic cell when the metadata is unexpected", () => {
    language = "en";
    expect(cellsOf({ old_validity: "weekly", new_validity: "single_use" }).details).toBe("old_validity: weekly, new_validity: single_use");
  });
});
