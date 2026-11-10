import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = {
  getLandingPageData: vi.fn(),
  saveLandingPageContent: vi.fn(),
  claimLandingPageName: vi.fn(),
  publishLandingPage: vi.fn(),
  unpublishLandingPage: vi.fn(),
};
vi.mock("@/services/landing-page", () => ({
  getLandingPageData: (...a: unknown[]) => svc.getLandingPageData(...a),
  saveLandingPageContent: (...a: unknown[]) => svc.saveLandingPageContent(...a),
  claimLandingPageName: (...a: unknown[]) => svc.claimLandingPageName(...a),
  publishLandingPage: (...a: unknown[]) => svc.publishLandingPage(...a),
  unpublishLandingPage: (...a: unknown[]) => svc.unpublishLandingPage(...a),
}));

import { claimPageNameAction, loadLandingPageAction, publishPageAction, saveLandingPageAction, unpublishPageAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of Object.values(svc)) f.mockResolvedValue({ data: null, error: null });
});

describe("landing page Server Actions", () => {
  it("each action takes no gym id: the service reads it from the session", async () => {
    await loadLandingPageAction();
    await saveLandingPageAction({ content: {} });
    await claimPageNameAction("grace-fit");
    await publishPageAction("classic");
    await unpublishPageAction();
    expect(svc.getLandingPageData).toHaveBeenCalledWith();
    expect(svc.saveLandingPageContent).toHaveBeenCalledWith({ content: {} });
    expect(svc.claimLandingPageName).toHaveBeenCalledWith("grace-fit");
    expect(svc.publishLandingPage).toHaveBeenCalledWith("classic");
    expect(svc.unpublishLandingPage).toHaveBeenCalledWith();
  });

  it("returns what the service returns", async () => {
    svc.publishLandingPage.mockResolvedValue({ data: { published: false, missing: ["no_logo"] }, error: null });
    expect(await publishPageAction("classic")).toEqual({ data: { published: false, missing: ["no_logo"] }, error: null });
  });
});
