/**
 * Story 29.3 (FR-053): the admin Classes page is closed to the Coach role. A Coach who opens /classes gets the global permission message and
 * no class, coach or timezone read is issued; every other staff role keeps the page exactly as before. Asserted on the element tree with
 * coach/classes/page.test.tsx's technique: reach through the page's <Suspense> to the async child and await it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const listClasses = vi.fn();
const getClassesGymTimezone = vi.fn();
vi.mock("@/services/classes", () => ({
  listClasses: (...a: unknown[]) => listClasses(...a),
  getClassesGymTimezone: (...a: unknown[]) => getClassesGymTimezone(...a),
}));

const listCoaches = vi.fn();
vi.mock("@/services/coaches", () => ({ listCoaches: (...a: unknown[]) => listCoaches(...a) }));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({ getDashboardShellContext: (...a: unknown[]) => getDashboardShellContext(...a) }));

vi.mock("./components/ClassesPageClient", () => ({
  ClassesPageClient: function ClassesPageClient() {
    return null;
  },
}));

import ClassesPage from "./page";
import { ClassesPageClient } from "./components/ClassesPageClient";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

async function renderPage(): Promise<ReactElement> {
  const boundary = ClassesPage() as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return await (child.type as AsyncComponent)(child.props);
}

function textContent(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!isValidElement(node)) return [];
  return textContent((node.props as { children?: ReactNode }).children);
}

function shellFor(role: string) {
  return { data: { role, memberId: "m1", memberName: "Someone", gymId: "g1" }, error: null, suspended: null };
}

describe("/classes", () => {
  beforeEach(() => {
    listClasses.mockReset().mockResolvedValue({ data: [], error: null });
    listCoaches.mockReset().mockResolvedValue({ data: [], error: null });
    getClassesGymTimezone.mockReset().mockResolvedValue({ data: "Africa/Douala", error: null });
    getDashboardShellContext.mockReset().mockResolvedValue(shellFor("manager"));
  });

  it("shows a Coach the global permission message and reads no class data", async () => {
    getDashboardShellContext.mockResolvedValue(shellFor("coach"));

    const tree = await renderPage();

    expect(textContent(tree)).toEqual(["errors.permissionDenied"]);
    expect(tree.type).not.toBe(ClassesPageClient);
    expect(listClasses).not.toHaveBeenCalled();
    expect(listCoaches).not.toHaveBeenCalled();
    expect(getClassesGymTimezone).not.toHaveBeenCalled();
  });

  it.each(["owner", "supervisor", "manager", "receptionist"])("leaves the page unchanged for the %s role", async (role) => {
    getDashboardShellContext.mockResolvedValue(shellFor(role));

    const tree = await renderPage();

    expect(tree.type).toBe(ClassesPageClient);
    expect(tree.props).toMatchObject({ role, gymTimezone: "Africa/Douala" });
    expect(listClasses).toHaveBeenCalledTimes(1);
    expect(listCoaches).toHaveBeenCalledTimes(1);
  });

  it("still shows the load error when the shell cannot be read", async () => {
    getDashboardShellContext.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" }, suspended: null });

    const tree = await renderPage();

    expect(textContent(tree)).toEqual(["common.loadError"]);
  });
});
