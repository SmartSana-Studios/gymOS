/** Story 24.9: the Settings row and the first-visit prompt. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => <a href={href} onClick={onClick}>{children}</a> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));

import { LandingPageSection, canSeeLandingPageRow, promptStorageKey } from "./LandingPageSection";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("who sees the row", () => {
  it.each([["owner", true], ["supervisor", true], ["support", true], ["manager", false], ["receptionist", false], ["coach", false], [null, false], [undefined, false]])(
    "%s -> %s",
    (role, expected) => expect(canSeeLandingPageRow(role as string | null | undefined)).toBe(expected),
  );
});

describe("the row", () => {
  it("shows the status badge (icon plus words) and an Open link, with no inputs", () => {
    render(<LandingPageSection state="in_progress" userKey="u1" />);
    expect(screen.getByTestId("page-status-badge").textContent).toBe("pageEditor.status.in_progress");
    expect(screen.getByText("pageEditor.settingsRow.open").closest("a")?.getAttribute("href")).toBe("/settings/landing-page");
    expect(document.querySelectorAll("input, textarea, select").length).toBe(0);
  });

  it("a state that could not be read shows an unknown label, not a wrong badge", () => {
    render(<LandingPageSection state={null} userKey="u1" />);
    expect(screen.queryByTestId("page-status-badge")).toBeNull();
    expect(screen.getByText("pageEditor.statusUnknown")).toBeTruthy();
  });
});

describe("first-visit prompt", () => {
  it("shows for a gym that has not started, with Set up and Not now", async () => {
    render(<LandingPageSection state="not_started" userKey="u1" />);
    expect(await screen.findByTestId("landing-page-prompt")).toBeTruthy();
    expect(screen.getByText("pageEditor.firstVisit.setUp")).toBeTruthy();
    expect(screen.getByText("pageEditor.firstVisit.notNow")).toBeTruthy();
  });

  it("does not show once the page is started", () => {
    render(<LandingPageSection state="in_progress" userKey="u1" />);
    expect(screen.queryByTestId("landing-page-prompt")).toBeNull();
  });

  it("Not now dismisses it, remembered per user in the browser", async () => {
    const { unmount } = render(<LandingPageSection state="not_started" userKey="u1" />);
    fireEvent.click(await screen.findByText("pageEditor.firstVisit.notNow"));
    expect(screen.queryByTestId("landing-page-prompt")).toBeNull();
    expect(window.localStorage.getItem(promptStorageKey("u1"))).toBe("1");
    unmount();
    render(<LandingPageSection state="not_started" userKey="u1" />);
    await waitFor(() => expect(screen.queryByTestId("landing-page-prompt")).toBeNull());
    unmount();
    render(<LandingPageSection state="not_started" userKey="u2" />);
    expect(await screen.findByTestId("landing-page-prompt")).toBeTruthy();
  });

  it("works when browser storage throws (private window): the prompt still shows and dismisses", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<LandingPageSection state="not_started" userKey="u1" />);
    fireEvent.click(await screen.findByText("pageEditor.firstVisit.notNow"));
    expect(screen.queryByTestId("landing-page-prompt")).toBeNull();
  });

  it("publishes nothing: there is no network call from the row", () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    render(<LandingPageSection state="not_started" userKey="u1" />);
    fireEvent.click(screen.getByText("pageEditor.firstVisit.notNow"));
    expect(f).not.toHaveBeenCalled();
  });
});
