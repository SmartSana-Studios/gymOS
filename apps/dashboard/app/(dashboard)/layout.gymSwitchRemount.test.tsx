/**
 * Regression test for the gym-switch staleness bug (2026-09-09, reported by
 * smartsana): after switching gyms, the switcher's own label updated but page
 * content kept showing the previous gym -- e.g. Settings' "Gym Name" field
 * still read "Obama Gym" while the chrome said "Martin Fitness".
 *
 * `GymSwitcher` calls `router.refresh()`, which re-renders Server Components
 * and delivers this layout's new gym props (that is why the switcher label
 * DID update), but deliberately PRESERVES client-component state. Pages like
 * Settings seed ~10 `useState` values from their server props, and `useState`
 * initialisers only run on mount -- so those values never re-seeded.
 *
 * The fix keys the page subtree on `gymId`, turning a gym switch into a
 * remount. This test asserts that invariant directly on the layout's rendered
 * element tree: a future refactor that drops the key would reintroduce a bug
 * whose symptom (stale data, no error anywhere) is very hard to trace back.
 *
 * Asserted at the element-tree level rather than through the DOM because
 * `DashboardLayoutData` is an async Server Component -- awaiting it and
 * inspecting what it returns needs no renderer, and keeps this test focused
 * on the one structural property that matters. Mocking shape follows
 * services/session.switchActiveGym.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const AVAILABLE_GYMS = [
  { gymId: "gym-a", gymName: "Gym A", role: "owner" as const },
  { gymId: "gym-b", gymName: "Gym B", role: "owner" as const },
];

function makeShell() {
  return {
    role: "owner" as const,
    gymId: "gym-a",
    gymName: "Gym A",
    memberName: "Owner One",
    mustChangePassword: false,
    availableGyms: AVAILABLE_GYMS,
  };
}

// Rebuilt in beforeEach rather than mutated-and-restored inside a test: a
// failing assertion would skip an end-of-body restore and leak the wrong gym
// into the next test (observed while red-green-checking this file).
let shell = makeShell();

/**
 * Story 1.19 review finding: the suspended branch returns BEFORE the keyed
 * Fragment, and carries its own gym switcher (`SwitchGymList`), so it needs
 * the same remount guarantee. Previously hard-coded to `null` here, which is
 * exactly why the gap went unnoticed.
 */
function makeSuspended() {
  return {
    isBillingSuspension: true,
    role: "owner" as const,
    gymId: "gym-a",
    gymName: "Gym A",
    mustChangePassword: false,
    availableGyms: AVAILABLE_GYMS,
  };
}

let suspended: ReturnType<typeof makeSuspended> | null = null;

const getDashboardShellContext = vi.fn(async () => ({
  data: suspended ? null : shell,
  error: null,
  suspended,
}));

vi.mock("@/services/session", () => ({
  getDashboardShellContext: () => getDashboardShellContext(),
}));

vi.mock("@/services/billing", () => ({
  listSelectableTiers: vi.fn(async () => ({ data: [], error: null })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect() should not be reached in this test");
  }),
}));

import DashboardLayout from "./layout";

/**
 * `DashboardLayout` returns <Suspense><DashboardLayoutData>...</></Suspense>.
 * `DashboardLayoutData` is the async component holding the real logic, so
 * reach it through the Suspense element and await it with its own props.
 */
async function renderLayout(): Promise<ReactElement> {
  const children = <main data-testid="page-content" />;
  const suspenseEl = DashboardLayout({ children }) as ReactElement<{ children: ReactElement }>;
  const dataEl = suspenseEl.props.children;
  const Component = dataEl.type as (props: unknown) => Promise<ReactElement>;
  return await Component(dataEl.props);
}

describe("(dashboard) layout — gym switch remount", () => {
  beforeEach(() => {
    shell = makeShell();
    suspended = null;
  });

  it("keys the page subtree on gymId so a gym switch remounts client state", async () => {
    const chrome = await renderLayout();

    // The keyed wrapper is the chrome's child, not the chrome itself: the
    // chrome holds only gym-independent state (mobileNavOpen).
    const wrapper = (chrome.props as { children: ReactElement }).children;

    expect(wrapper.key).toBe("gym-a");
    expect((wrapper.props as { children: ReactElement }).children).toBeTruthy();
  });

  it("changes that key when the active gym changes, forcing a remount", async () => {
    const first = await renderLayout();

    shell.gymId = "gym-b";
    shell.gymName = "Gym B";
    const second = await renderLayout();

    const keyOf = (el: ReactElement) => (el.props as { children: ReactElement }).children.key;

    expect(keyOf(first)).toBe("gym-a");
    expect(keyOf(second)).toBe("gym-b");
    // A differing key is precisely what makes React discard the old subtree
    // instead of re-rendering it with new props (which preserved the stale
    // useState values).
    expect(keyOf(first)).not.toBe(keyOf(second));
  });

  it("passes the active gym through to the chrome", async () => {
    const chrome = await renderLayout();
    const props = chrome.props as { gymId: string; gymName: string };

    expect(props.gymId).toBe("gym-a");
    expect(props.gymName).toBe("Gym A");
  });

  /**
   * Story 1.19 review finding: the suspended screens sit on a branch that
   * returns before the keyed Fragment, yet they render `SwitchGymList` and a
   * full `PayNowButton`. Unkeyed, a suspended -> suspended switch re-rendered
   * the same instances and preserved `PayNowButton`'s in-flight payment
   * watch, leaving the Pay Now button disabled against the previous gym's
   * payment -- so an Owner of two suspended gyms could not pay for the
   * second without a full reload.
   */
  it("keys the owner suspended screen on gymId so a suspended -> suspended switch remounts", async () => {
    suspended = makeSuspended();
    const first = await renderLayout();

    suspended = { ...makeSuspended(), gymId: "gym-b", gymName: "Gym B" };
    const second = await renderLayout();

    expect(first.key).toBe("gym-a");
    expect(second.key).toBe("gym-b");
    expect(first.key).not.toBe(second.key);
  });

  it("keys the neutral suspended screen on gymId too", async () => {
    suspended = { ...makeSuspended(), role: "staff" as never };
    const first = await renderLayout();

    suspended = { ...makeSuspended(), role: "staff" as never, gymId: "gym-b", gymName: "Gym B" };
    const second = await renderLayout();

    expect(first.key).toBe("gym-a");
    expect(second.key).toBe("gym-b");
  });
});
