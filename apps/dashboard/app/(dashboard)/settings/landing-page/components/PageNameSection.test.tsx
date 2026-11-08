import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const claimPageNameAction = vi.fn();
vi.mock("../actions", () => ({ claimPageNameAction: (...a: unknown[]) => claimPageNameAction(...a) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join(",")}` : key), i18n: { language: "en" } }),
}));

import { PageNameSection, pageNameRuleError } from "./PageNameSection";

const none = { name: null, state: "none" as const, pending_name: null, completed_renames: 0, redirects: [] };
const active = { name: "grace-fit", state: "active" as const, pending_name: null, completed_renames: 0, redirects: [] };

beforeEach(() => vi.clearAllMocks());

describe("pageNameRuleError", () => {
  it.each([
    ["ab", "length"],
    ["a".repeat(31), "length"],
    ["Gym_Fit", "chars"],
    ["xn--abc", "chars"],
    ["-gym", "edge"],
    ["gym-", "edge"],
    ["gy--m", "double"],
    ["12345", "digits"],
  ])("%s -> %s", (name, rule) => expect(pageNameRuleError(name)).toBe(rule));
  it.each(["grace-fit", "abc", "a1b2", "gym-2"])("%s is fine", (name) => expect(pageNameRuleError(name)).toBeNull());
});

describe("PageNameSection", () => {
  it("Owner: claim opens a modal, checks the grammar inline and calls the server once", async () => {
    claimPageNameAction.mockResolvedValue({ data: { state: "active" }, error: null });
    const onChanged = vi.fn();
    const onToast = vi.fn();
    render(<PageNameSection pageName={none} isOwner live={false} onChanged={onChanged} onToast={onToast} />);
    fireEvent.click(screen.getByText("pageEditor.name.claim"));
    const input = await screen.findByLabelText("pageEditor.name.label");
    fireEvent.change(input, { target: { value: "AB" } });
    expect((input as HTMLInputElement).value).toBe("ab");
    fireEvent.click(screen.getByText("pageEditor.name.claimButton"));
    expect(await screen.findByText("pageEditor.name.rules.length")).toBeTruthy();
    expect(claimPageNameAction).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "grace-fit" } });
    fireEvent.click(screen.getByText("pageEditor.name.claimButton"));
    await waitFor(() => expect(claimPageNameAction).toHaveBeenCalledWith("grace-fit"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("pageEditor.name.toastClaimed"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("a held name says it is under review", async () => {
    claimPageNameAction.mockResolvedValue({ data: { state: "held" }, error: null });
    const onToast = vi.fn();
    render(<PageNameSection pageName={none} isOwner live={false} onChanged={vi.fn()} onToast={onToast} />);
    fireEvent.click(screen.getByText("pageEditor.name.claim"));
    fireEvent.change(await screen.findByLabelText("pageEditor.name.label"), { target: { value: "grace-gym" } });
    fireEvent.click(screen.getByText("pageEditor.name.claimButton"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("pageEditor.name.toastHeld"));
  });

  it("a typed server error stays inline and the modal stays open", async () => {
    claimPageNameAction.mockResolvedValue({ data: null, error: { code: "name_taken", message: "pageNames.errors.name_taken" } });
    render(<PageNameSection pageName={none} isOwner live={false} onChanged={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(screen.getByText("pageEditor.name.claim"));
    fireEvent.change(await screen.findByLabelText("pageEditor.name.label"), { target: { value: "grace-fit" } });
    fireEvent.click(screen.getByText("pageEditor.name.claimButton"));
    expect(await screen.findByText("pageNames.errors.name_taken")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("an active name offers Change and shows the address", () => {
    render(<PageNameSection pageName={active} isOwner live onChanged={vi.fn()} onToast={vi.fn()} />);
    expect(screen.getByTestId("page-name-state").textContent).toContain("grace-fit.gymosapps.com");
    expect(screen.getByText("pageEditor.name.change")).toBeTruthy();
    expect(screen.queryByText("pageEditor.name.reservedWhileOffline")).toBeNull();
  });

  it("an unpublished page with a name shows the reservation note", () => {
    render(<PageNameSection pageName={active} isOwner live={false} onChanged={vi.fn()} onToast={vi.fn()} />);
    expect(screen.getByText("pageEditor.name.reservedWhileOffline")).toBeTruthy();
  });

  it("non-Owner: plain text and the one sentence; no button at all", () => {
    render(<PageNameSection pageName={active} isOwner={false} live onChanged={vi.fn()} onToast={vi.fn()} />);
    expect(screen.getByText("pageEditor.name.ownerOnly")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("both renames used: the field and the button are replaced by the explanation", async () => {
    render(<PageNameSection pageName={{ ...active, completed_renames: 2 }} isOwner live onChanged={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(screen.getByText("pageEditor.name.change"));
    expect(await screen.findByText("pageEditor.name.renamesUsed")).toBeTruthy();
    expect(screen.queryByLabelText("pageEditor.name.label")).toBeNull();
    expect(screen.queryByText("pageEditor.name.rename")).toBeNull();
  });
});
