/** Story 24.9: the publish screen. The list is the would-be snapshot; the server result is trusted. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const publishPageAction = vi.fn();
const loadLandingPageAction = vi.fn();
const unpublishPageAction = vi.fn();

vi.mock("../actions", () => ({
  publishPageAction: (...a: unknown[]) => publishPageAction(...a),
  loadLandingPageAction: (...a: unknown[]) => loadLandingPageAction(...a),
  unpublishPageAction: (...a: unknown[]) => unpublishPageAction(...a),
  saveLandingPageAction: vi.fn(),
  claimPageNameAction: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join(",")}` : key),
    i18n: { language: "en" },
  }),
}));

import { gymCategoryLabel } from "@gymos/types";
import { PublishScreen } from "./PublishScreen";
import { makeData } from "../testData";

const snapshot = {
  name: "Grace Fit",
  category: "pilates_studio",
  about_en: "x".repeat(120),
  services_en: "Reformer",
  address: "Rue 1",
  city: "Douala",
  country: "CM",
  contact: { phone: "+237600111222" },
  hours: { mon: { open: "06:00", close: "20:00" }, sun: null },
  color: "#1A2B3C",
  gallery: ["a.webp", "b.webp"],
  plans: [{ name: "Monthly", label_en: "Monthly", label_fr: "Monthly", type: "monthly", price: 25000, currency: "XAF", interval: "monthly", duration_days: 30 }],
};
const readyData = (over: Record<string, unknown> = {}) =>
  makeData({
    pageName: { name: "grace-fit", state: "active", pending_name: null, completed_renames: 0, redirects: [] },
    status: {
      state: "ready",
      missing: [],
      languages: [{ code: "en", complete: true, characters: 120, needed: 0 }, { code: "fr", complete: false, characters: 68, needed: 32 }],
      snapshot,
      ...over,
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadLandingPageAction.mockResolvedValue({ data: null, error: null });
});

describe("what becomes public", () => {
  it("states the address and lists the snapshot, one About and one Services row per language, 'Not included' for the incomplete one", () => {
    render(<PublishScreen initial={readyData()} />);
    expect(screen.getByTestId("public-address").textContent).toContain("https://grace-fit.gymosapps.com");
    const about = screen.getByTestId("publish-row-about_en");
    expect(about.textContent).toContain("x".repeat(120));
    expect(screen.getByTestId("publish-row-about_fr").textContent).toContain("pageEditor.publish.notIncluded");
    expect(screen.getByTestId("publish-row-services_fr").textContent).toContain("pageEditor.publish.notIncluded");
    expect(screen.getByTestId("publish-row-services_en").textContent).toContain("Reformer");
    expect(screen.getByTestId("publish-row-languages").textContent).toContain("pageEditor.publish.notOffered");
    expect(screen.getByTestId("publish-row-contact").textContent).toContain("+237600111222");
    expect(screen.getByTestId("publish-row-plans").textContent).toContain("25,000 XAF");
    expect(screen.getByTestId("publish-row-gallery").textContent).toContain("pageEditor.publish.galleryCount|2");
    expect(screen.getByTestId("never-shown").textContent).toBe("pageEditor.publish.neverShown");
  });

  it("the category row shows the label, not the stored code", () => {
    render(<PublishScreen initial={readyData()} />);
    const row = screen.getByTestId("publish-row-category");
    expect(row.textContent).toContain(gymCategoryLabel("pilates_studio", "en"));
    expect(row.textContent).not.toContain("pilates_studio");
  });

  it("a row with no value in the snapshot reads Not included", () => {
    render(<PublishScreen initial={readyData({ snapshot: { name: "Grace Fit" } })} />);
    expect(screen.getByTestId("publish-row-hours").textContent).toContain("pageEditor.publish.notIncluded");
    expect(screen.getByTestId("publish-row-gallery").textContent).toContain("pageEditor.publish.notIncluded");
  });
});

describe("publishing", () => {
  it("[Publish page] is disabled until the one attestation box is ticked", () => {
    render(<PublishScreen initial={readyData()} />);
    const button = screen.getByText("pageEditor.publish.button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("success: the address, Copy link, View page and the 2-minute note, with focus on the success region", async () => {
    publishPageAction.mockResolvedValue({ data: { published: true, missing: [] }, error: null });
    render(<PublishScreen initial={readyData()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("pageEditor.publish.button"));
    const region = await screen.findByTestId("publish-success");
    expect(publishPageAction).toHaveBeenCalledWith("classic");
    expect(region.textContent).toContain("pageEditor.publish.success|grace-fit.gymosapps.com");
    expect(within(region).getByText("pageEditor.publish.copyLink")).toBeTruthy();
    expect(within(region).getByText("pageEditor.publish.viewPage").getAttribute("href")).toBe("https://grace-fit.gymosapps.com");
    expect(region.textContent).toContain("pageEditor.publish.twoMinutes");
    await waitFor(() => expect(document.activeElement).toBe(region));
  });

  it("a stale checklist: the server says published false, nothing is shown as published, and the missing items link to their fields", async () => {
    publishPageAction.mockResolvedValue({ data: { published: false, missing: ["no_banner", "about_short"] }, error: null });
    render(<PublishScreen initial={readyData()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("pageEditor.publish.button"));
    const list = await screen.findByTestId("publish-not-ready");
    expect(screen.queryByTestId("publish-success")).toBeNull();
    const links = within(list).getAllByText("pageEditor.checklist.goTo").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/settings/landing-page#page-images", "/settings/landing-page#page-text"]);
    expect(list.textContent).toContain("pageEditor.gateItem.about_short");
  });

  it("a taken-down page shows the banner and no Publish button, no attestation", () => {
    render(<PublishScreen initial={readyData({ state: "taken_down" })} />);
    expect(screen.getByTestId("banner-taken-down")).toBeTruthy();
    expect(screen.queryByText("pageEditor.publish.button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("the typed taken_down refusal is shown from the server", async () => {
    publishPageAction.mockResolvedValue({ data: null, error: { code: "taken_down", message: "pagePublish.errors.taken_down" } });
    render(<PublishScreen initial={readyData()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("pageEditor.publish.button"));
    expect((await screen.findByTestId("publish-error")).textContent).toBe("pagePublish.errors.taken_down");
  });

  it("a known gate failure disables nothing silently: the list is shown from the start", () => {
    render(<PublishScreen initial={readyData({ state: "in_progress", missing: ["no_logo"] })} />);
    expect(screen.getByTestId("publish-not-ready").textContent).toContain("pageEditor.gateItem.no_logo");
  });
});

describe("a live page", () => {
  it("is read-only: the list, View page and Unpublish, with no attestation and no Publish", () => {
    render(<PublishScreen initial={readyData({ state: "published" })} />);
    expect(screen.getByTestId("publish-list")).toBeTruthy();
    expect(screen.getByText("pageEditor.header.unpublish")).toBeTruthy();
    expect(screen.queryByText("pageEditor.publish.button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("Unpublish asks first, and is always allowed", async () => {
    unpublishPageAction.mockResolvedValue({ data: { wasLive: true }, error: null });
    render(<PublishScreen initial={readyData({ state: "published" })} />);
    fireEvent.click(screen.getByText("pageEditor.header.unpublish"));
    const dialog = await screen.findByRole("dialog");
    expect(unpublishPageAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("pageEditor.unpublish.confirm"));
    await waitFor(() => expect(unpublishPageAction).toHaveBeenCalledTimes(1));
  });
});
