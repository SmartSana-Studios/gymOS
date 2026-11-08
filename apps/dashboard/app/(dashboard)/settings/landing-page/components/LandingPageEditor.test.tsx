/**
 * Story 24.9: the editor. Role-gated DOM, the language tabs, text cleaning on save, the warning before a save that would take a live
 * page offline, and the disabled/absent publish controls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const saveLandingPageAction = vi.fn();
const loadLandingPageAction = vi.fn();
const claimPageNameAction = vi.fn();

vi.mock("../actions", () => ({
  saveLandingPageAction: (...a: unknown[]) => saveLandingPageAction(...a),
  loadLandingPageAction: (...a: unknown[]) => loadLandingPageAction(...a),
  claimPageNameAction: (...a: unknown[]) => claimPageNameAction(...a),
  publishPageAction: vi.fn(),
  unpublishPageAction: vi.fn(),
}));
vi.mock("../../page-media-actions", () => ({
  uploadPageMediaAction: vi.fn(),
  preparePageLogoAction: vi.fn(),
  deletePageMediaAction: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join(",")}` : key),
    i18n: { language: "en" },
  }),
}));

import { LandingPageEditor } from "./LandingPageEditor";
import { makeData } from "../testData";

beforeEach(() => {
  vi.clearAllMocks();
  loadLandingPageAction.mockResolvedValue({ data: null, error: null });
  saveLandingPageAction.mockImplementation(async () => ({ data: makeData(), error: null }));
});

describe("role-gated DOM", () => {
  it("the Owner gets a claim control", () => {
    render(<LandingPageEditor initial={makeData({ role: "owner" })} />);
    expect(screen.getByText("pageEditor.name.claim")).toBeTruthy();
    expect(screen.queryByText("pageEditor.name.ownerOnly")).toBeNull();
  });

  it.each(["supervisor", "support"] as const)("a %s sees read-only text and NO claim or change control in the DOM", (role) => {
    render(<LandingPageEditor initial={makeData({ role })} />);
    expect(screen.getByText("pageEditor.name.ownerOnly")).toBeTruthy();
    expect(screen.queryByText("pageEditor.name.claim")).toBeNull();
    expect(screen.queryByText("pageEditor.name.change")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // controls are removed, not disabled
    expect(screen.queryByRole("button", { name: /pageEditor\.name\./ })).toBeNull();
  });

  it("a Supervisor still gets the editing controls", () => {
    render(<LandingPageEditor initial={makeData({ role: "supervisor" })} />);
    expect(screen.getByText("pageEditor.save")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });
});

describe("header controls by state", () => {
  it("in progress: Review & publish is disabled and the missing items are listed with links", () => {
    render(<LandingPageEditor initial={makeData()} />);
    expect((screen.getByTestId("review-disabled") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("page-status-badge").getAttribute("data-state")).toBe("in_progress");
    expect(screen.getByTestId("checklist-banner").getAttribute("data-ready")).toBe("false");
    expect(screen.getByTestId("checklist-category").getAttribute("data-ready")).toBe("true");
    const link = within(screen.getByTestId("checklist-hours")).getByText("pageEditor.checklist.goTo");
    expect(link.getAttribute("href")).toBe("#page-hours");
  });

  it("ready: Review & publish is a link to the publish screen", () => {
    render(<LandingPageEditor initial={makeData({ status: { state: "ready", missing: [] } })} />);
    const link = screen.getByText("pageEditor.header.reviewAndPublish").closest("a");
    expect(link?.getAttribute("href")).toBe("/settings/landing-page/publish");
  });

  it("published: Unpublish is offered and the 2-minute line shows", () => {
    render(<LandingPageEditor initial={makeData({ status: { state: "published", missing: [] } })} />);
    expect(screen.getByText("pageEditor.header.unpublish")).toBeTruthy();
    expect(screen.getByTestId("live-info")).toBeTruthy();
  });

  it("taken down: the banner shows, with no Publish and no Appeal control", () => {
    render(<LandingPageEditor initial={makeData({ status: { state: "taken_down", missing: [] } })} />);
    expect(screen.getByTestId("banner-taken-down")).toBeTruthy();
    expect(screen.queryByText("pageEditor.header.reviewAndPublish")).toBeNull();
    expect(screen.queryByTestId("review-disabled")).toBeNull();
    expect(screen.queryByText(/appeal/i)).toBeNull();
  });

  it("offline by the gate: one banner line per code still failing, in checklist order, with the way out", () => {
    render(
      <LandingPageEditor
        initial={makeData({ status: { state: "offline_gate", unpublished_reasons: ["no_banner", "no_logo"], missing: ["no_logo", "no_banner"] } })}
      />,
    );
    const banner = screen.getByTestId("banner-offline");
    const items = within(banner).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("pageEditor.gate.no_logo");
    expect(items[1]).toContain("pageEditor.gate.no_banner");
    expect(within(banner).getByText("pageEditor.banner.fixAndPublish")).toBeTruthy();
  });
});

describe("page text tabs", () => {
  it("a fresh editor shows only the default language's tab, with an Add button for the other", () => {
    render(<LandingPageEditor initial={makeData()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByText(/pageEditor\.text\.addOne/)).toBeTruthy();
  });

  it("adding a language adds a tab, selects it and removes the Add button; typed text survives switching tabs", () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.click(screen.getByText(/pageEditor\.text\.addOne/));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.queryByText(/pageEditor\.text\.addOne/)).toBeNull();
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.change(document.getElementById("about-fr") as HTMLTextAreaElement, { target: { value: "Bonjour" } });
    fireEvent.click(tabs[0]);
    expect((document.getElementById("about-en") as HTMLTextAreaElement).value).toBe("x".repeat(60));
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect((document.getElementById("about-fr") as HTMLTextAreaElement).value).toBe("Bonjour");
  });

  it("roving tabindex and arrow keys move between tabs", () => {
    render(<LandingPageEditor initial={makeData({ content: { ...makeData().content, services: { en: "", fr: "Yoga" } } })} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    const after = screen.getAllByRole("tab");
    expect(after.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(after.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    fireEvent.keyDown(after[1], { key: "Home" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "End" });
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("the About counter is local and live", () => {
    render(<LandingPageEditor initial={makeData()} />);
    expect(screen.getByTestId("about-counter").textContent).toContain("60,2000");
    fireEvent.change(document.getElementById("about-en") as HTMLTextAreaElement, { target: { value: "y".repeat(75) } });
    expect(screen.getByTestId("about-counter").textContent).toContain("75,2000");
  });

  it("the default language's tab has no Remove button; another tab has one", () => {
    render(<LandingPageEditor initial={makeData({ content: { ...makeData().content, services: { en: "", fr: "Yoga" } } })} />);
    expect(screen.queryByText(/pageEditor\.text\.remove\|/)).toBeNull();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getByText(/pageEditor\.text\.remove\|/)).toBeTruthy();
  });
});

describe("saving", () => {
  it("normalises CRLF to LF before the call and shows the cleaned text (matrix: pasted Windows text)", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById("about-en") as HTMLTextAreaElement, { target: { value: "one\r\ntwo\rthree" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalled());
    const input = saveLandingPageAction.mock.calls[0][0] as { content: Record<string, unknown> };
    expect(input.content.about_en).toBe("one\ntwo\nthree");
    expect((document.getElementById("about-en") as HTMLTextAreaElement).value).toBe("one\ntwo\nthree");
  });

  it("rejects < inline, naming the field and the language, and does not call the server", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById("about-en") as HTMLTextAreaElement, { target: { value: "a <b> c" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    const alert = await screen.findByText(/pageEditor\.errors\.angle/);
    expect(alert.textContent).toContain("pageEditor.fieldWithLanguage");
    expect(saveLandingPageAction).not.toHaveBeenCalled();
  });

  it("an error on another tab selects that tab", async () => {
    render(<LandingPageEditor initial={makeData({ content: { ...makeData().content, services: { en: "", fr: "Yoga" } } })} />);
    fireEvent.click(screen.getAllByRole("tab")[1]);
    fireEvent.change(document.getElementById("about-fr") as HTMLTextAreaElement, { target: { value: "<" } });
    fireEvent.click(screen.getAllByRole("tab")[0]);
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true"));
    expect(saveLandingPageAction).not.toHaveBeenCalled();
  });

  it("sends one switch per plan and no label fields", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalled());
    const input = saveLandingPageAction.mock.calls[0][0] as { plans: Record<string, unknown>[] };
    expect(input.plans).toEqual([{ plan_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", is_public: true }]);
    expect(JSON.stringify(input)).not.toContain("label");
  });

  it("last public plan off on a live page: warns first, nothing is saved until confirmed", async () => {
    const base = makeData();
    const data = makeData({
      status: { state: "published", missing: [] },
      content: { ...base.content, about: { en: "x".repeat(150), fr: "" }, city: "Douala", contactPhone: "+237600111222", hours: { mon: { open: "06:00", close: "22:00" } } },
      plans: [{ ...base.plans[0], isPublic: true }],
    });
    render(<LandingPageEditor initial={data} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("pageEditor.save"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("pageEditor.gateItem.no_public_plan|")).toBeTruthy();
    expect(saveLandingPageAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("pageEditor.warn.confirm"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalledTimes(1));
  });

  it("a page that is not live saves with no warning", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the typed server error, not a raw message", async () => {
    saveLandingPageAction.mockResolvedValue({ data: null, error: { code: "gym_not_active", message: "pageEditor.errors.gym_not_active" } });
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.click(screen.getByText("pageEditor.save"));
    expect(await screen.findByText("pageEditor.errors.gym_not_active")).toBeTruthy();
  });
});

describe("plans", () => {
  it("lists every plan read-only with its own currency and one switch, default off", () => {
    render(<LandingPageEditor initial={makeData()} />);
    const switchEl = screen.getByRole("switch");
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/10,000 XAF/)).toBeTruthy();
    expect(document.querySelectorAll("#page-plans input").length).toBe(0);
  });
});

describe("template", () => {
  it("one launch card, Classic, shown as a static selected card (no radio role, no tab stop)", () => {
    render(<LandingPageEditor initial={makeData()} />);
    const card = screen.getByTestId("template-classic");
    expect(card.getAttribute("data-selected")).toBe("true");
    expect(card.getAttribute("role")).toBeNull();
    expect(card.getAttribute("tabindex")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("pageEditor.templates.more")).toBeTruthy();
  });
});

describe("plan switch name and error links", () => {
  it("the switch is named 'Show on my page' plus the plan name", () => {
    render(<LandingPageEditor initial={makeData()} />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-label")).toBe("pageEditor.plans.show - Monthly");
    expect(sw.getAttribute("aria-labelledby")).toBeNull();
  });

  it.each([
    ["pageCity", "city", "<"],
    ["pageAddress", "address", ">"],
  ])("a %s error paragraph is linked to its input with aria-describedby", async (inputId, key, bad) => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById(inputId) as HTMLInputElement, { target: { value: bad } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(document.getElementById(`err-${key}`)).not.toBeNull());
    expect(document.getElementById(inputId)?.getAttribute("aria-describedby")).toBe(`err-${key}`);
  });

  it("lat/lng, phone and hours errors are linked too", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById("pageLat") as HTMLInputElement, { target: { value: "4" } });
    fireEvent.change(document.getElementById("pagePhone") as HTMLInputElement, { target: { value: "123" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(document.getElementById("err-latlng")).not.toBeNull());
    expect(document.getElementById("pageLat")?.getAttribute("aria-describedby")).toBe("err-latlng");
    expect(document.getElementById("pageLng")?.getAttribute("aria-describedby")).toBe("err-latlng");
    expect(document.getElementById("pagePhone")?.getAttribute("aria-describedby")).toBe("err-contact-phone");
  });

  it("an About error is linked to its textarea", async () => {
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById("about-en") as HTMLTextAreaElement, { target: { value: "a<b" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(document.getElementById("about-en-error")).not.toBeNull());
    expect(document.getElementById("about-en")?.getAttribute("aria-describedby")).toContain("about-en-error");
  });
});

describe("remove a language", () => {
  const withFrench = (status: Record<string, unknown> = {}) =>
    makeData({
      content: { ...makeData().content, services: { en: "", fr: "Yoga" }, about: { en: "x".repeat(150), fr: "y".repeat(40) } },
      status: { languages: [{ code: "en", complete: true, characters: 150, needed: 0 }, { code: "fr", complete: false, characters: 40, needed: 60 }], ...status },
    });

  async function openRemove() {
    fireEvent.click(screen.getAllByRole("tab")[1]);
    fireEvent.click(screen.getByText(/pageEditor\.text\.remove\|/));
    return screen.findByRole("dialog");
  }

  it("confirm saves only the two nulls, drops the tab and selects the default tab", async () => {
    render(<LandingPageEditor initial={withFrench()} />);
    const dialog = await openRemove();
    fireEvent.click(within(dialog).getAllByText(/pageEditor\.text\.remove\|/).pop() as HTMLElement);
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalledTimes(1));
    expect(saveLandingPageAction.mock.calls[0][0]).toEqual({ content: { about_fr: null, services_fr: null } });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.getElementById("about-en")).not.toBeNull();
  });

  it("a server error keeps the dialog open and keeps the tab", async () => {
    saveLandingPageAction.mockResolvedValue({ data: null, error: { code: "not_admitted", message: "pageEditor.errors.not_admitted" } });
    render(<LandingPageEditor initial={withFrench()} />);
    const dialog = await openRemove();
    fireEvent.click(within(dialog).getAllByText(/pageEditor\.text\.remove\|/).pop() as HTMLElement);
    expect(await within(dialog).findByText("pageEditor.errors.not_admitted")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("tab", { hidden: true })).toHaveLength(2);
  });

  it("on a live page whose other language is incomplete (saved), the offline warning shows", async () => {
    const data = withFrench({ state: "published", missing: [], languages: [{ code: "en", complete: false, characters: 60, needed: 40 }, { code: "fr", complete: true, characters: 120, needed: 0 }] });
    render(<LandingPageEditor initial={data} />);
    const dialog = await openRemove();
    expect(within(dialog).getByText("pageEditor.text.removeOffline")).toBeTruthy();
    expect(within(dialog).getByText("pageEditor.text.removeAndUnpublish")).toBeTruthy();
  });

  it("unsaved text in the other language does NOT count: the warning still shows when the saved English is incomplete", async () => {
    const data = withFrench({ state: "published", missing: [], languages: [{ code: "en", complete: false, characters: 60, needed: 40 }, { code: "fr", complete: true, characters: 120, needed: 0 }] });
    render(<LandingPageEditor initial={data} />);
    fireEvent.click(screen.getAllByRole("tab")[0]);
    fireEvent.change(document.getElementById("about-en") as HTMLTextAreaElement, { target: { value: "z".repeat(300) } });
    const dialog = await openRemove();
    expect(within(dialog).getByText("pageEditor.text.removeOffline")).toBeTruthy();
  });

  it("no warning when the other language is complete in the saved data", async () => {
    render(<LandingPageEditor initial={withFrench({ state: "published", missing: [] })} />);
    const dialog = await openRemove();
    expect(within(dialog).queryByText("pageEditor.text.removeOffline")).toBeNull();
  });
});

describe("a stored save whose reload failed", () => {
  it("is treated as saved: no error, a distinct toast, and a refresh follows", async () => {
    saveLandingPageAction.mockResolvedValue({ data: null, error: null, reloadFailed: true });
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.change(document.getElementById("pageCity") as HTMLInputElement, { target: { value: "Douala" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    expect(await screen.findByText("pageEditor.savedReloadFailed")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(loadLandingPageAction).toHaveBeenCalled());
    // the saved values are the new baseline: leaving is not "unsaved"
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("unsaved changes guard", () => {
  const readyData = () => makeData({ status: { state: "ready", missing: [] } });

  it("a clean form: no beforeunload handler effect and no confirm on Review & publish", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LandingPageEditor initial={readyData()} />);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByText("pageEditor.header.reviewAndPublish"));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("a dirty form: beforeunload is prevented and Review & publish asks first (cancel keeps you here)", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LandingPageEditor initial={readyData()} />);
    fireEvent.change(document.getElementById("pageCity") as HTMLInputElement, { target: { value: "Douala" } });
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("pageEditor.header.reviewAndPublish").dispatchEvent(click);
    expect(confirm).toHaveBeenCalledWith("pageEditor.unsavedConfirm");
    expect(click.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    const click2 = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("pageEditor.header.reviewAndPublish").dispatchEvent(click2);
    expect(click2.defaultPrevented).toBe(false);
    confirm.mockRestore();
  });

  it("after a successful save the form is clean again", async () => {
    render(<LandingPageEditor initial={readyData()} />);
    fireEvent.change(document.getElementById("pageCity") as HTMLInputElement, { target: { value: "Douala" } });
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalled());
    await screen.findByText("pageEditor.savedToast");
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("refresh ordering", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("a focus during a save does not read", async () => {
    const save = deferred<unknown>();
    saveLandingPageAction.mockReturnValue(save.promise);
    render(<LandingPageEditor initial={makeData()} />);
    fireEvent.click(screen.getByText("pageEditor.save"));
    await waitFor(() => expect(saveLandingPageAction).toHaveBeenCalled());
    window.dispatchEvent(new Event("focus"));
    expect(loadLandingPageAction).not.toHaveBeenCalled();
    save.resolve({ data: makeData(), error: null });
    await screen.findByText("pageEditor.savedToast");
    window.dispatchEvent(new Event("focus"));
    expect(loadLandingPageAction).toHaveBeenCalledTimes(1);
  });

  it("a slow older read cannot overwrite a newer one that was applied first", async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    loadLandingPageAction.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    render(<LandingPageEditor initial={makeData()} />);
    window.dispatchEvent(new Event("focus")); // request 1 (slow)
    window.dispatchEvent(new Event("focus")); // request 2 (fast)
    fast.resolve({ data: makeData({ status: { state: "ready", missing: [] } }), error: null });
    await waitFor(() => expect(screen.getByTestId("page-status-badge").getAttribute("data-state")).toBe("ready"));
    slow.resolve({ data: makeData({ status: { state: "in_progress" } }), error: null }); // the stale answer arrives last
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("page-status-badge").getAttribute("data-state")).toBe("ready");
  });
});
