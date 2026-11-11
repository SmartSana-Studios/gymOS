import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const takeDownPage = vi.fn();
const dismissPageReports = vi.fn();
const closePageReportsTakenDown = vi.fn();
const decidePageAppeal = vi.fn();
const liftPageTakedown = vi.fn();
vi.mock("../actions", () => ({
  takeDownPage: (...a: unknown[]) => takeDownPage(...a),
  dismissPageReports: (...a: unknown[]) => dismissPageReports(...a),
  closePageReportsTakenDown: (...a: unknown[]) => closePageReportsTakenDown(...a),
  decidePageAppeal: (...a: unknown[]) => decidePageAppeal(...a),
  liftPageTakedown: (...a: unknown[]) => liftPageTakedown(...a),
}));
vi.mock("../../page-names/actions", () => ({ decideHeldPageName: vi.fn() }));
vi.mock("@/components/step-up-prompt", () => ({
  StepUpPrompt: ({ action, subjectId, onIssued }: { action: string; subjectId: string; onIssued: () => void }) => (
    <button onClick={onIssued}>{`step-up ${action} ${subjectId}`}</button>
  ),
}));
const refresh = vi.fn();
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push }),
  usePathname: () => "/pages",
  useSearchParams: () => new URLSearchParams(),
}));

import en from "../../../../locales/en.json";
import fr from "../../../../locales/fr.json";
import { menuItems, pickRowAction, renderWithI18n } from "../../support/components/support-test-utils";
import { ActivePagesPanel } from "./ActivePagesPanel";
import { AppealsPanel } from "./AppealsPanel";
import { PagesClient } from "./PagesClient";
import { ReportsPanel, groupReports } from "./ReportsPanel";
import { TakedownDialog } from "./TakedownDialog";
import { GymPageBlock } from "../../gyms/[id]/components/GymPageBlock";
import type { ActivePageRow, PageAppealRow, PageReportRow } from "../actions";

const GYM = "11111111-1111-4111-8111-111111111111";
const GYM2 = "22222222-2222-4222-8222-222222222222";
const report = (over: Partial<PageReportRow> = {}): PageReportRow => ({
  id: "r1", gymId: GYM, gymName: "Iron Gym", pageName: "iron-gym", reason: "impersonation", details: "Pretends to be a bank <b>now</b>",
  createdAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-09T10:00:00Z", overdue: false, pageTakenDown: false, ...over,
});
const appeal = (over: Partial<PageAppealRow> = {}): PageAppealRow => ({
  id: "a1", gymId: GYM, gymName: "Iron Gym", pageName: "iron-gym", takedownReason: "trademark", takedownNote: "Seen on a poster", takenDownAt: "2026-11-01T10:00:00Z",
  appealReason: "The mark is ours", appealedAt: "2026-11-02T10:00:00Z", decision: null, decisionReason: null, decidedAt: null, takedownLifted: false, ...over,
});

const activeRow = (over: Partial<ActivePageRow> = {}): ActivePageRow => ({
  gymId: GYM, gymName: "Iron Gym", pageName: "iron-gym", template: "classic", publishedAt: "2026-11-05T10:00:00Z", status: "live", ...over,
});

beforeEach(() => {
  [takeDownPage, dismissPageReports, closePageReportsTakenDown, decidePageAppeal, liftPageTakedown, refresh, replace, push].forEach((m) => m.mockReset());
});

describe("ReportsPanel", () => {
  it("says so when no report is waiting", () => {
    renderWithI18n(<ReportsPanel rows={[]} />);
    expect(screen.getByText("No reports to review.")).toBeTruthy();
  });

  it("groups the reports of one page: a count, the first report, the soonest due and an Overdue mark", () => {
    const rows = [report({ id: "r1", createdAt: "2026-11-03T10:00:00Z", dueAt: "2026-11-10T10:00:00Z" }), report({ id: "r2", createdAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-09T10:00:00Z", overdue: true }), report({ id: "r3", gymId: GYM2, gymName: "Other Gym", pageName: "other-gym", dueAt: "2026-11-08T10:00:00Z" })];
    const groups = groupReports(rows);
    expect(groups.map((g) => [g.pageName, g.rows.length])).toEqual([["other-gym", 1], ["iron-gym", 2]]);
    expect(groups[1]).toMatchObject({ firstReportedAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-09T10:00:00Z", overdue: true });
    renderWithI18n(<ReportsPanel rows={rows} />);
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
  });

  it("shows each report's reason and message as plain text, never as markup", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report()]} />);
    await pickRowAction(user, "iron-gym", "Show reports");
    expect(screen.getByText("Pretends to be a bank <b>now</b>")).toBeTruthy();
    expect(document.querySelector("li b")).toBeNull();
    expect(screen.getByText(/Impersonation/)).toBeTruthy();
  });

  it("dismisses all the page's reports with a note of 3 to 500 characters", async () => {
    dismissPageReports.mockResolvedValue({ data: { closed: 2 }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report({ id: "r1" }), report({ id: "r2" })]} />);
    await pickRowAction(user, "iron-gym", "Dismiss reports");
    const dlg = within(await screen.findByRole("dialog"));
    expect((dlg.getByRole("button", { name: "Dismiss reports" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(dlg.getByRole("textbox"), "Checked: their own logo");
    await user.click(dlg.getByRole("button", { name: "Dismiss reports" }));
    await waitFor(() => expect(dismissPageReports).toHaveBeenCalledWith({ reportIds: ["r1", "r2"], note: "Checked: their own logo" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toContain("were dismissed");
  });

  it("takes the page down from a report: the reason list has the six codes, 'Other' needs a note, and the reports travel with it", async () => {
    takeDownPage.mockResolvedValue({ data: { takedownId: "t", reportsClosed: 1 }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report()]} />);
    await pickRowAction(user, "iron-gym", "Take down…");
    const dlg = within(await screen.findByRole("dialog"));
    expect(dlg.getAllByRole("option").map((o) => o.textContent)).toEqual(["Impersonation", "Illegal content", "Trademark", "Misleading content", "Privacy", "Other"]);
    await user.selectOptions(dlg.getByRole("combobox"), "other");
    expect((dlg.getByRole("button", { name: "Take down page" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(dlg.getByRole("textbox"), "ab");
    expect((dlg.getByRole("button", { name: "Take down page" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(dlg.getByRole("textbox"), "c");
    await user.click(dlg.getByRole("button", { name: "Take down page" }));
    await waitFor(() => expect(takeDownPage).toHaveBeenCalledWith({ gymId: GYM, reason: "other", note: "abc", reportIds: ["r1"] }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("asks for the authenticator code when the server wants a step-up, then retries once", async () => {
    takeDownPage.mockResolvedValueOnce({ data: null, error: { code: "step_up_required", message: "Confirm" } }).mockResolvedValueOnce({ data: { takedownId: "t", reportsClosed: 0 }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report()]} />);
    await pickRowAction(user, "iron-gym", "Take down…");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down page" }));
    await user.click(await screen.findByRole("button", { name: `step-up take_down_gym_page ${GYM}` }));
    await waitFor(() => expect(takeDownPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a server refusal inside the dialog and keeps it open", async () => {
    takeDownPage.mockResolvedValue({ data: null, error: { code: "already_taken_down", message: "This page is already taken down." } });
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report()]} />);
    await pickRowAction(user, "iron-gym", "Take down…");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down page" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This page is already taken down.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a page already taken down offers to close its reports, not to take it down again", async () => {
    closePageReportsTakenDown.mockResolvedValue({ data: { closed: 1 }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report({ pageTakenDown: true })]} />);
    expect(await menuItems(user, "iron-gym")).toEqual(["Show reports", "Close reports"]);
    expect(screen.getByText("Taken down")).toBeTruthy();
    await pickRowAction(user, "iron-gym", "Close reports");
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Close reports" }));
    await waitFor(() => expect(closePageReportsTakenDown).toHaveBeenCalledWith({ reportIds: ["r1"] }));
  });

  it("French copy", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ReportsPanel rows={[report({ overdue: true })]} />, "fr");
    expect(screen.getByText("En retard")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Actions pour iron-gym" }));
    const items = within(await screen.findByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toContain("Classer les signalements");
    expect(items).toContain("Retirer…");
  });
});

describe("AppealsPanel", () => {
  it("says so when none is waiting", () => {
    renderWithI18n(<AppealsPanel rows={[]} />);
    expect(screen.getByText("No appeals waiting.")).toBeTruthy();
  });

  it("lists the takedown reason and note, the appeal text and its status; only an undecided appeal has actions", () => {
    renderWithI18n(<AppealsPanel rows={[appeal(), appeal({ id: "a2", decision: "uphold", decisionReason: "Still a copy", gymName: "Gym Two" })]} />);
    expect(screen.getAllByText("Trademark")).toHaveLength(2);
    expect(screen.getAllByText("Internal note: Seen on a poster")).toHaveLength(2);
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("Takedown upheld")).toBeTruthy();
    expect(screen.getByText("Still a copy")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Actions for iron-gym" })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: "Lift takedown" })).toHaveLength(0);
  });

  it("the Actions menu of an undecided appeal holds Lift and Uphold", async () => {
    const user = userEvent.setup();
    renderWithI18n(<AppealsPanel rows={[appeal()]} />);
    expect(await menuItems(user, "iron-gym")).toEqual(["Lift takedown", "Uphold takedown"]);
  });

  it("uphold needs a reason of 3 to 500 characters and sends it with the appeal and the gym", async () => {
    decidePageAppeal.mockResolvedValue({ data: { decision: "uphold" }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<AppealsPanel rows={[appeal()]} />);
    await pickRowAction(user, "iron-gym", "Uphold takedown");
    const dlg = within(await screen.findByRole("dialog"));
    expect((dlg.getByRole("button", { name: "Uphold takedown" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(dlg.getByRole("textbox"), "It copies a registered mark");
    await user.click(dlg.getByRole("button", { name: "Uphold takedown" }));
    await waitFor(() => expect(decidePageAppeal).toHaveBeenCalledWith({ id: "a1", gymId: GYM, decision: "uphold", reason: "It copies a registered mark" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("lift asks for the authenticator code bound to the gym", async () => {
    decidePageAppeal.mockResolvedValueOnce({ data: null, error: { code: "step_up_required", message: "Confirm" } }).mockResolvedValueOnce({ data: { decision: "lift" }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<AppealsPanel rows={[appeal()]} />);
    await pickRowAction(user, "iron-gym", "Lift takedown");
    const dlg = within(await screen.findByRole("dialog"));
    await user.type(dlg.getByRole("textbox"), "The mark is theirs");
    await user.click(dlg.getByRole("button", { name: "Lift takedown" }));
    await user.click(await screen.findByRole("button", { name: `step-up lift_gym_page_takedown ${GYM}` }));
    await waitFor(() => expect(decidePageAppeal).toHaveBeenCalledTimes(2));
  });
});

describe("PagesClient", () => {
  const held = [{ id: "h1", gymId: GYM, gymName: "Iron Gym", name: "x-fitness", origin: "claim", heldReason: "generic_word:fitness", heldAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-04T10:00:00Z", overdue: false, currentName: null }];

  it("has the four tabs (the first three with counts), opens on the one asked for and writes the choice to the URL", async () => {
    const user = userEvent.setup();
    renderWithI18n(<PagesClient initialTab="reports" held={held} reports={[report()]} appeals={[appeal(), appeal({ id: "a2", decision: "lift" })]} active={[activeRow()]} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["Held names", "Reports", "Appeals", "Active"]);
    expect(screen.getByRole("tab", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Held names/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Reports/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Appeals/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Reports/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: /Appeals/ }));
    expect(replace).toHaveBeenCalledWith("/pages?tab=appeals", { scroll: false });
    await user.click(screen.getByRole("tab", { name: "Active" }));
    expect(replace).toHaveBeenCalledWith("/pages?tab=active", { scroll: false });
    expect(await screen.findByText("iron-gym.gymosapps.com")).toBeTruthy();
  });
});

describe("ActivePagesPanel", () => {
  const rows = [
    activeRow(),
    activeRow({ gymId: GYM2, gymName: "Other Gym", pageName: "other-gym", status: "taken_down", template: "volt", publishedAt: "2026-11-04T10:00:00Z" }),
    activeRow({ gymId: "33333333-3333-4333-8333-333333333333", gymName: "Sleepy Gym", pageName: "sleepy", status: "paused" }),
  ];

  it("says so when no page is published, with no search box", () => {
    renderWithI18n(<ActivePagesPanel rows={[]} />);
    expect(screen.getByText("No page is published yet.")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("says the list could not be loaded when the database function failed, in English and French, with no table", () => {
    renderWithI18n(<ActivePagesPanel rows={null} />);
    expect(screen.getByRole("alert").textContent).toBe(en.pages.active.loadFailed);
    expect(screen.queryByRole("table")).toBeNull();
    expect(fr.pages.active.loadFailed).not.toBe(en.pages.active.loadFailed);
  });

  it("lists each page once with its address, gym, template, date and status", () => {
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    const body = screen.getAllByRole("row").slice(1);
    expect(body).toHaveLength(3);
    expect(within(body[0]!).getByText("iron-gym.gymosapps.com")).toBeTruthy();
    expect(within(body[0]!).getByText("Iron Gym")).toBeTruthy();
    expect(within(body[0]!).getByText("Classic")).toBeTruthy();
    expect(within(body[0]!).getByText("Live")).toBeTruthy();
    expect(within(body[1]!).getByText("Volt")).toBeTruthy();
    expect(within(body[1]!).getByText("Taken down")).toBeTruthy();
    expect(within(body[2]!).getByText("Paused")).toBeTruthy();
  });

  it("search narrows the list by page name, gym or address, ignoring case, and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    const box = screen.getByRole("searchbox");
    await user.type(box, "OTHER");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    expect(screen.getByText("other-gym.gymosapps.com")).toBeTruthy();
    await user.clear(box);
    await user.type(box, "sleepy gym");
    expect(screen.getByText("sleepy.gymosapps.com")).toBeTruthy();
    await user.clear(box);
    await user.type(box, "iron-gym.gymosapps");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    await user.clear(box);
    await user.type(box, "zzz");
    expect(screen.getByText("No page matches your search.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("the Actions menu depends on the status: Live, Taken down, Paused", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    expect(await menuItems(user, "iron-gym")).toEqual(["Open page", "View gym", "Take down…"]);
    expect(await menuItems(user, "other-gym")).toEqual(["View gym", "Lift takedown"]);
    expect(await menuItems(user, "sleepy")).toEqual(["View gym"]);
  });

  it("Open page opens the address in a new tab; View gym goes to the gym", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    await pickRowAction(user, "iron-gym", "Open page");
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://iron-gym.gymosapps.com", "_blank", "noopener,noreferrer"));
    await pickRowAction(user, "iron-gym", "View gym");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/gyms/${GYM}`));
    open.mockRestore();
  });

  it("Take down from the list runs the same takedown with the step-up retry", async () => {
    takeDownPage.mockResolvedValueOnce({ data: null, error: { code: "step_up_required", message: "Confirm" } }).mockResolvedValueOnce({ data: { takedownId: "t", reportsClosed: 0 }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    await pickRowAction(user, "iron-gym", "Take down…");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down page" }));
    await user.click(await screen.findByRole("button", { name: `step-up take_down_gym_page ${GYM}` }));
    await waitFor(() => expect(takeDownPage).toHaveBeenCalledTimes(2));
    expect(takeDownPage).toHaveBeenLastCalledWith({ gymId: GYM, reason: "impersonation" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Lift takedown from the list sends the reason for that gym and asks for the code", async () => {
    liftPageTakedown.mockResolvedValue({ data: { lifted: true }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={rows} />);
    await pickRowAction(user, "other-gym", "Lift takedown");
    const dlg = within(await screen.findByRole("dialog"));
    await user.type(dlg.getByRole("textbox"), "Resolved with the owner");
    await user.click(dlg.getByRole("button", { name: "Lift takedown" }));
    await waitFor(() => expect(liftPageTakedown).toHaveBeenCalledWith({ gymId: GYM2, reason: "Resolved with the owner" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a page whose name is gone shows a placeholder and no Open page", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ActivePagesPanel rows={[activeRow({ pageName: null })]} />);
    expect(screen.getByText("(no name)")).toBeTruthy();
    expect(await menuItems(user, "Iron Gym")).toEqual(["View gym", "Take down…"]);
  });

  it("French copy", () => {
    renderWithI18n(<ActivePagesPanel rows={rows} />, "fr");
    expect(screen.getByText("En ligne")).toBeTruthy();
    expect(screen.getByText("Retirée")).toBeTruthy();
    expect(screen.getByText("En pause")).toBeTruthy();
  });
});

describe("TakedownDialog (standalone)", () => {
  it("offers the reason labels in French in the French interface", async () => {
    renderWithI18n(<TakedownDialog gymId={GYM} pageName="iron-gym" onDone={vi.fn()} onClose={vi.fn()} />, "fr");
    const dlg = within(await screen.findByRole("dialog"));
    expect(dlg.getAllByRole("option").map((o) => o.textContent)).toEqual(["Usurpation d'identité", "Contenu illicite", "Marque déposée", "Contenu trompeur", "Vie privée", "Autre"]);
    expect(dlg.getByRole("button", { name: "Retirer la page" })).toBeTruthy();
  });
});

describe("GymPageBlock (SA-03)", () => {
  it("shows the state, the takedown reason and the appeal, and offers Lift for a taken-down page only", async () => {
    liftPageTakedown.mockResolvedValue({ data: { lifted: true }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<GymPageBlock gymId={GYM} data={{ state: "taken_down", reason: "privacy", appeal: { state: "open", submitted_at: "2026-11-02T10:00:00Z", decided_at: null, decision_reason: null }, pageName: "iron-gym" }} />);
    expect(screen.getByText("iron-gym")).toBeTruthy();
    expect(screen.getByText("Taken down")).toBeTruthy();
    expect(screen.getByText("Reason: Privacy")).toBeTruthy();
    expect(screen.getByText("Appeal waiting for a decision")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take down page…" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lift takedown" }));
    const dlg = within(await screen.findByRole("dialog"));
    await user.type(dlg.getByRole("textbox"), "Resolved with the owner");
    await user.click(dlg.getByRole("button", { name: "Lift takedown" }));
    await waitFor(() => expect(liftPageTakedown).toHaveBeenCalledWith({ gymId: GYM, reason: "Resolved with the owner" }));
  });
  it("offers Take down only for a state that has a page row", () => {
    for (const state of ["published", "offline_gate", "offline_suspended", "offline_name_released"] as const) {
      const { unmount } = renderWithI18n(<GymPageBlock gymId={GYM} data={{ state, reason: null, appeal: null, pageName: "iron-gym" }} />);
      expect(screen.queryByRole("button", { name: "Take down page…" }), state).not.toBeNull();
      unmount();
    }
    for (const state of ["not_started", "in_progress", "ready", "taken_down"] as const) {
      const { unmount } = renderWithI18n(<GymPageBlock gymId={GYM} data={{ state, reason: state === "taken_down" ? "privacy" : null, appeal: null, pageName: "iron-gym" }} />);
      expect(screen.queryByRole("button", { name: "Take down page…" }), state).toBeNull();
      unmount();
    }
  });

  it("offers Take down for a published page and says when the state could not be loaded", () => {
    const { unmount } = renderWithI18n(<GymPageBlock gymId={GYM} data={{ state: "published", reason: null, appeal: null, pageName: "iron-gym" }} />);
    expect(screen.getByRole("button", { name: "Take down page…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lift takedown" })).toBeNull();
    unmount();
    renderWithI18n(<GymPageBlock gymId={GYM} data={null} />);
    expect(screen.getByText("The page state could not be loaded.")).toBeTruthy();
  });
});

describe("copy", () => {
  const get = (o: unknown, path: string[]) => path.reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);
  it("every pages.* key the screens and actions use exists in English and French", () => {
    const keys = [
      "title", "hint", "tabs.names", "tabs.reports", "tabs.appeals", "tabs.active", "active.hint", "active.empty", "active.noMatch", "active.search", "active.status.live", "active.status.taken_down", "active.status.paused", "active.actions.open", "active.actions.viewGym", "active.actions.takeDown", "active.actions.lift", "active.columns.domain", "active.columns.status", "active.templates.classic", "active.noName", "reports.empty", "reports.overdue", "reports.dismiss", "reports.takeDown", "reports.closeTakenDown",
      "takedown.title", "takedown.description", "takedown.submit", "takedown.lift", "takedown.liftSubmit", "appeals.empty", "appeals.lift", "appeals.uphold",
      "gym.title", "gym.takeDown", "gym.appeal.none", "gym.appeal.open", "gym.appeal.lift", "gym.appeal.uphold",
      ...["not_started", "in_progress", "ready", "published", "offline_gate", "offline_suspended", "offline_name_released", "taken_down"].map((s) => `gym.states.${s}`),
      ...["generic", "invalid", "reason_required", "note_required", "note_invalid", "invalid_reason", "no_page", "already_taken_down", "not_taken_down", "invalid_outcome", "invalid_decision", "not_found", "not_open", "gym_not_found"].map((c) => `errors.${c}`),
    ];
    for (const lang of [en, fr]) for (const k of keys) expect(String(get(lang, ["pages", ...k.split(".")]) ?? "").length, k).toBeGreaterThan(0);
  });
});
