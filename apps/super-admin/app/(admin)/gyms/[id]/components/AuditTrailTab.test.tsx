import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";
import type { AuditTrailEntry } from "@/services/gyms";
import { AuditTrailTab } from "./AuditTrailTab";

const ENTRY = {
  id: "00000000-0000-4000-8000-0000000000a1",
  actionType: "gym_category_changed",
  actorId: "00000000-0000-4000-8000-0000000000b1",
  actorDisplayName: "Chidi",
  targetEntityId: null,
  metadata: { old_category: "gym", new_category: "yoga_studio" },
  createdAt: "2026-10-15T10:00:00Z",
} as unknown as AuditTrailEntry;

function renderTab(lng: "en" | "fr") {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    lng,
    resources: RESOURCES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <AuditTrailTab entries={[ENTRY]} />
    </I18nextProvider>,
  );
}

describe("AuditTrailTab gym_category_changed label", () => {
  it("renders the English label", () => {
    renderTab("en");
    expect(screen.getByText("Category changed")).toBeTruthy();
  });

  it("renders the French label", () => {
    renderTab("fr");
    expect(screen.getByText("Catégorie modifiée")).toBeTruthy();
  });
});

describe("AuditTrailTab real person (Story 23.8)", () => {
  function renderWith(realActors: Record<string, { subjectId: string; realUserId: string; name: string | null; email: string | null; recordedAt: string }>) {
    const i18n = createInstance();
    i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
    return render(
      <I18nextProvider i18n={i18n}>
        <AuditTrailTab entries={[{ ...ENTRY, actorDisplayName: "GymOS Support" } as AuditTrailEntry]} realActors={realActors} />
      </I18nextProvider>,
    );
  }

  it("shows the real person under a GymOS Support entry", () => {
    renderWith({ [ENTRY.id]: { subjectId: ENTRY.id, realUserId: "u-1", name: "Zed Realperson", email: "zed@gymosapps.com", recordedAt: "2026-10-21T10:00:00Z" } });
    expect(screen.getByText("Real person: Zed Realperson (zed@gymosapps.com)")).toBeTruthy();
  });

  it("shows nothing extra when no identity was returned", () => {
    renderWith({});
    expect(screen.queryByText(/Real person/)).toBeNull();
  });
});
