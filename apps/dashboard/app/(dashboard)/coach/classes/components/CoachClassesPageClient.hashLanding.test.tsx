/**
 * Story 17.5 (AC #5, #15): arriving on My Classes with `#class-<id>` -- a My
 * Next Sessions row on the Coach Portal Overview -- opens that class and
 * scrolls it into view. Kept apart from CoachClassesPageClient.test.tsx, whose
 * Story 17.4 cases stay untouched.
 *
 *  - on mount and on `hashchange`; an unknown hash does nothing;
 *  - it opens the class only -- no session, no roster fetch;
 *  - a re-render with new props never re-opens a class the Coach collapsed.
 *
 * The hash is set with `history.replaceState`, which fires no event. Setting
 * `window.location.hash` would make jsdom fire `hashchange` asynchronously
 * (setTimeout 0), outside `act`, doubling the handler and leaking an event
 * into the next test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoachRosterRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

type RosterResult = { data: CoachRosterRow[] | null; error: { code: string; message: string } | null };
const getMySessionRosterAction = vi.fn<(classSessionId: string) => Promise<RosterResult>>();
vi.mock("../actions", () => ({
  getMySessionRosterAction: (classSessionId: string) => getMySessionRosterAction(classSessionId),
}));

import { CoachClassesPageClient, type CoachClassView } from "./CoachClassesPageClient";

const CLASSES: CoachClassView[] = [
  {
    classId: "class-hiit",
    className: "HIIT Circuit",
    scheduleLabel: "Mon, Wed, Fri at 18:00",
    capacityLabel: "Capacity 15",
    sessions: [{ classSessionId: "session-a", label: "Session A", bookedLabel: "2/15 booked" }],
  },
  {
    classId: "class-workshop",
    className: "Weekend Workshop",
    scheduleLabel: "Aug 31, 10:00",
    capacityLabel: "Capacity 10",
    sessions: [{ classSessionId: "session-w", label: "Session W", bookedLabel: "1/10 booked" }],
  },
];

function classButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("CoachClassesPageClient hash landing", () => {
  beforeEach(() => {
    getMySessionRosterAction.mockReset().mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("opens and scrolls to the class named by the hash on arrival, and nothing else", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    window.history.replaceState(null, "", "#class-class-workshop");

    render(<CoachClassesPageClient classes={CLASSES} />);

    expect(classButton(/Weekend Workshop/)).toHaveAttribute("aria-expanded", "true");
    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Session W/ })).toHaveAttribute("aria-expanded", "false");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("class-class-workshop"));
    expect(getMySessionRosterAction).not.toHaveBeenCalled();
  });

  it("ignores a hash that names no listed class", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    window.history.replaceState(null, "", "#class-somebody-elses-class");

    render(<CoachClassesPageClient classes={CLASSES} />);

    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "false");
    expect(classButton(/Weekend Workshop/)).toHaveAttribute("aria-expanded", "false");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(getMySessionRosterAction).not.toHaveBeenCalled();
  });

  it("opens the class when the hash changes after mount", () => {
    render(<CoachClassesPageClient classes={CLASSES} />);
    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "false");

    act(() => {
      window.history.replaceState(null, "", "#class-class-hiit");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "true");
    expect(getMySessionRosterAction).not.toHaveBeenCalled();
  });

  it("lets the Coach collapse a class the hash opened, and a re-render does not re-open it", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "#class-class-workshop");
    const { rerender } = render(<CoachClassesPageClient classes={CLASSES} />);

    await user.click(classButton(/Weekend Workshop/));
    expect(classButton(/Weekend Workshop/)).toHaveAttribute("aria-expanded", "false");

    rerender(<CoachClassesPageClient classes={[...CLASSES]} />);

    expect(classButton(/Weekend Workshop/)).toHaveAttribute("aria-expanded", "false");
    expect(getMySessionRosterAction).not.toHaveBeenCalled();
  });

  it("stops listening for hash changes once unmounted, removing the very handler it added", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<CoachClassesPageClient classes={CLASSES} />);
    const added = addEventListener.mock.calls.find(([type]) => type === "hashchange")?.[1];
    expect(added).toBeTypeOf("function");

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("hashchange", added);
  });
});
