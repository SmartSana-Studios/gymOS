/**
 * Story 24.11 (AD-27): the taken-down banner. The reason label, the Owner-only Appeal (500 characters), the appeal sent, the decision reason of an
 * upheld appeal, and the same words in English and French as the single source in @gymos/types.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PAGE_TAKEDOWN_REASONS, PAGE_TAKEDOWN_REASON_LABELS } from "@gymos/types";

const submitPageAppealAction = vi.fn();
vi.mock("../actions", () => ({ submitPageAppealAction: (...a: unknown[]) => submitPageAppealAction(...a) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join(",")}` : key),
    i18n: { language: "en" },
  }),
}));

import en from "../../../../../locales/en.json";
import fr from "../../../../../locales/fr.json";
import { StatusBanner } from "./StatusBanner";
import { makeStatus } from "../testData";

const none = { state: "none", submitted_at: null, decided_at: null, decision_reason: null };
const taken = (appeal: Record<string, unknown> | null, reason: string | null = "impersonation") => makeStatus({ state: "taken_down", missing: [], taken_down_reason: reason, appeal });

beforeEach(() => {
  vi.clearAllMocks();
  submitPageAppealAction.mockResolvedValue({ data: { state: "open" }, error: null });
});

describe("the taken-down banner", () => {
  it("names the reason and offers Appeal to the Owner", () => {
    render(<StatusBanner status={taken(none)} role="owner" />);
    expect(screen.getByTestId("banner-taken-down").textContent).toContain("pageEditor.banner.takenDownReason|pageEditor.takedownReason.impersonation");
    expect(screen.getByTestId("appeal-button").textContent).toBe("pageEditor.banner.appeal");
  });

  it("supervisor and support: no button in the DOM, only the line that says who can appeal", () => {
    for (const role of ["supervisor", "support"]) {
      const { unmount } = render(<StatusBanner status={taken(none)} role={role} />);
      expect(screen.queryByTestId("appeal-button")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByTestId("appeal-owner-only")).toBeTruthy();
      // "You can appeal." is not said to someone who cannot
      expect(screen.getByTestId("banner-taken-down").textContent).toContain("pageEditor.banner.takenDownReasonNoAppeal|");
      unmount();
    }
  });

  it("falls back to the generic sentence when the reason is missing or unknown", () => {
    render(<StatusBanner status={taken(none, null)} role="owner" />);
    expect(screen.getByTestId("banner-taken-down").textContent).toContain("pageEditor.banner.takenDown");
    expect(screen.getByTestId("banner-taken-down").textContent).not.toContain("takenDownReason");
  });

  it("after an appeal: the date, and no button", () => {
    render(<StatusBanner status={taken({ state: "open", submitted_at: "2026-11-09T10:00:00Z", decided_at: null, decision_reason: null })} role="owner" />);
    expect(screen.getByTestId("appeal-sent").textContent).toContain("pageEditor.banner.appealSent|");
    expect(screen.getByTestId("appeal-sent").textContent).toMatch(/2026/);
    expect(screen.queryByTestId("appeal-button")).toBeNull();
    expect(screen.getByTestId("banner-taken-down").textContent).toContain("pageEditor.banner.takenDownReasonNoAppeal|");
  });

  it("an upheld appeal shows the decision reason and offers no second appeal, to anyone", () => {
    for (const role of ["owner", "supervisor"]) {
      const { unmount } = render(<StatusBanner status={taken({ state: "uphold", submitted_at: "2026-11-09T10:00:00Z", decided_at: "2026-11-10T10:00:00Z", decision_reason: "It copies a registered mark" })} role={role} />);
      expect(screen.getByTestId("appeal-upheld").textContent).toContain("It copies a registered mark");
      expect(screen.queryByTestId("appeal-button")).toBeNull();
      expect(screen.getByTestId("banner-taken-down").textContent).not.toContain("pageEditor.banner.takenDownReason|");
      unmount();
    }
  });

  it("the Appeal modal needs a reason, counts to 500, sends it trimmed and refreshes the page data", async () => {
    const onChanged = vi.fn();
    render(<StatusBanner status={taken(none)} role="owner" onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("appeal-button"));
    const area = (await screen.findByLabelText("pageAppeal.label")) as HTMLTextAreaElement;
    expect(area.getAttribute("maxlength")).toBe("500");
    const send = screen.getByText("pageAppeal.send").closest("button") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(area, { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(area, { target: { value: "  The mark is ours  " } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(submitPageAppealAction).toHaveBeenCalledWith("The mark is ours"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText("pageAppeal.label")).toBeNull());
  });

  it("a refusal stays in the modal; an appeal that already exists also refreshes the banner", async () => {
    const onChanged = vi.fn();
    submitPageAppealAction.mockResolvedValue({ data: null, error: { code: "appeal_open", message: "You already sent an appeal." } });
    render(<StatusBanner status={taken(none)} role="owner" onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("appeal-button"));
    fireEvent.change(await screen.findByLabelText("pageAppeal.label"), { target: { value: "Again" } });
    fireEvent.click(screen.getByText("pageAppeal.send"));
    await waitFor(() => expect(screen.getByText("You already sent an appeal.")).toBeTruthy());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByLabelText("pageAppeal.label")).toBeTruthy();
  });

  it.each([
    ["appeal_open", true],
    ["appeal_decided", true],
    ["not_taken_down", true],
    ["reason_required", false],
  ])("a refused appeal (%s) %s the banner refresh", async (code, refreshes) => {
    const onChanged = vi.fn();
    submitPageAppealAction.mockResolvedValue({ data: null, error: { code, message: `msg-${code}` } });
    render(<StatusBanner status={taken(none)} role="owner" onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("appeal-button"));
    fireEvent.change(await screen.findByLabelText("pageAppeal.label"), { target: { value: "Again" } });
    fireEvent.click(screen.getByText("pageAppeal.send"));
    await waitFor(() => expect(screen.getByText(`msg-${code}`)).toBeTruthy());
    // the state changed under the Owner for the first three: the banner re-reads it; a plain validation refusal does not
    await waitFor(() => expect(onChanged.mock.calls.length > 0).toBe(refreshes));
  });
});

describe("the words", () => {
  it("the six reason labels in both locales are the single source in @gymos/types", () => {
    for (const code of PAGE_TAKEDOWN_REASONS) {
      expect((en as { pageEditor: { takedownReason: Record<string, string> } }).pageEditor.takedownReason[code]).toBe(PAGE_TAKEDOWN_REASON_LABELS[code].en);
      expect((fr as { pageEditor: { takedownReason: Record<string, string> } }).pageEditor.takedownReason[code]).toBe(PAGE_TAKEDOWN_REASON_LABELS[code].fr);
    }
  });
  it("the banner and appeal sentences are the product owner's AD-27 copy", () => {
    const e = (en as { pageEditor: { banner: Record<string, string> } }).pageEditor.banner;
    expect(e.takenDownReason).toBe("GymOS took your page down: {{reason}}. Your page name stays reserved for you. You can appeal.");
    expect(e.appealSent).toBe("Appeal sent on {{date}}. GymOS will decide and tell you.");
    const f = (fr as { pageEditor: { banner: Record<string, string> } }).pageEditor.banner;
    expect(f.takenDownReason).toBe("GymOS a retiré votre page : {{reason}}. Le nom de votre page reste réservé pour vous. Vous pouvez faire appel.");
    expect(f.appealSent).toBe("Appel envoyé le {{date}}. GymOS décidera et vous répondra.");
    // the same sentence without the appeal clause, for the states where the Owner cannot appeal
    expect(e.takenDownReasonNoAppeal).toBe(e.takenDownReason.replace(" You can appeal.", ""));
    expect(f.takenDownReasonNoAppeal).toBe(f.takenDownReason.replace(" Vous pouvez faire appel.", ""));
  });
  it("every pageAppeal error code the service can return has copy in both locales", async () => {
    const { PAGE_APPEAL_ERROR_CODES } = await import("@gymos/types");
    for (const d of [en, fr] as { pageAppeal: { errors: Record<string, string> } }[]) {
      for (const c of [...PAGE_APPEAL_ERROR_CODES, "generic"]) expect(d.pageAppeal.errors[c], c).toBeTruthy();
    }
  });
});
