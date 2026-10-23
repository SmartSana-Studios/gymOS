/** Story 23.9: the notice bell is an Owner-only part of the header. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }) }));
vi.mock("@/components/shared/NoticeBell", () => ({ NoticeBell: () => <div data-testid="notice-bell" /> }));
vi.mock("@/components/shared/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/shared/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { TopBar } from "./TopBar";

afterEach(cleanup);

describe("TopBar notice bell", () => {
  it("renders for an owner", () => {
    render(<TopBar onOpenMobileNav={() => {}} memberName="Ada" role="owner" />);
    expect(screen.getByTestId("notice-bell")).toBeTruthy();
  });

  it.each(["supervisor", "manager", "receptionist", "coach", "support"] as const)("is not rendered for %s", (role) => {
    render(<TopBar onOpenMobileNav={() => {}} memberName="Ada" role={role} />);
    expect(screen.queryByTestId("notice-bell")).toBeNull();
  });
});
