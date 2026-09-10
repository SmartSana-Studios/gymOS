/**
 * Story 17.1 (AC #10): the Overview's 60-second stat refresh. Pins the
 * behaviours that matter -- it ticks every 60s, it SKIPS a tick while any
 * modal is open (every modal in this app is a native `<dialog>` opened via
 * showModal(), including the RenewalModal that FrontDeskAlertPanel owns, so
 * a refresh must never land under a half-typed renewal), it SKIPS ticks while
 * the tab is hidden and catches up once on becoming visible, and it stops on
 * unmount so navigating away leaves no interval or listener behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const refresh = vi.fn();
const router = { refresh };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { OVERVIEW_REFRESH_INTERVAL_MS, OverviewAutoRefresh } from "./OverviewAutoRefresh";

// jsdom's `document.hidden` is a prototype getter; shadow it on the instance
// and delete the shadow afterwards to restore it.
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function becomeVisible() {
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("OverviewAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
    Reflect.deleteProperty(document, "hidden");
  });

  it("polls every 60 seconds", () => {
    expect(OVERVIEW_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("renders nothing", () => {
    const { container } = render(<OverviewAutoRefresh />);

    expect(container.firstChild).toBeNull();
  });

  it("refreshes on each 60s tick and not before", () => {
    render(<OverviewAutoRefresh />);

    vi.advanceTimersByTime(59_999);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips the tick while a modal dialog is open, and resumes once it closes", () => {
    render(<OverviewAutoRefresh />);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    dialog.removeAttribute("open");
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a closed dialog in the document", () => {
    render(<OverviewAutoRefresh />);
    document.body.appendChild(document.createElement("dialog"));

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips every tick while the tab is hidden", () => {
    setHidden(true);
    render(<OverviewAutoRefresh />);

    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("catches up exactly once when a hidden tab that missed a tick becomes visible", () => {
    setHidden(true);
    render(<OverviewAutoRefresh />);
    vi.advanceTimersByTime(120_000);

    becomeVisible();
    expect(refresh).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on becoming visible when no tick was missed", () => {
    setHidden(true);
    render(<OverviewAutoRefresh />);
    vi.advanceTimersByTime(30_000);

    becomeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not catch up under an open modal on becoming visible", () => {
    setHidden(true);
    render(<OverviewAutoRefresh />);
    vi.advanceTimersByTime(60_000);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);

    becomeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears its interval and visibility listener on unmount", () => {
    setHidden(true);
    const { unmount } = render(<OverviewAutoRefresh />);
    vi.advanceTimersByTime(60_000);
    unmount();

    becomeVisible();
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
