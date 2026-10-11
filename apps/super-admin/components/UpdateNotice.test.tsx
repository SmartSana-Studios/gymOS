import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../locales/en.json";

const buildId = vi.hoisted(() => ({ value: "build-a" }));
vi.mock("@/lib/build-id", () => ({
  get BUILD_ID() {
    return buildId.value;
  },
}));

import { UpdateNotice } from "./UpdateNotice";

function jsonResponse(body: unknown, init: { ok?: boolean; type?: string } = {}) {
  return {
    ok: init.ok ?? true,
    headers: { get: () => init.type ?? "application/json" },
    json: async () => body,
  } as unknown as Response;
}

function renderNotice() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: enTranslations } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <UpdateNotice />
    </I18nextProvider>,
  );
}

async function focusTab() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
  });
}

describe("UpdateNotice", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    buildId.value = "build-a";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows nothing while the server is on the build this tab loaded", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: "build-a" }));
    renderNotice();
    await focusTab();

    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a refresh when the server is on a newer build", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: "build-b" }));
    renderNotice();
    await focusTab();

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("A new version is available")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("'Later' hides it until the server moves to yet another build", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: "build-b" }));
    renderNotice();
    await focusTab();
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();

    await focusTab();
    expect(screen.queryByRole("status")).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ version: "build-c" }));
    await focusTab();
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("'Refresh' reloads the page", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    fetchMock.mockResolvedValue(jsonResponse({ version: "build-b" }));
    renderNotice();
    await focusTab();
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stays silent on a failed, redirected or malformed response", async () => {
    renderNotice();
    for (const response of [
      jsonResponse({ version: "build-b" }, { ok: false }),
      jsonResponse({ version: "build-b" }, { type: "text/html" }),
      jsonResponse({ nope: true }),
      jsonResponse({ version: "" }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      await focusTab();
    }
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await focusTab();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is off in local dev, where there is no build id", async () => {
    buildId.value = "dev";
    fetchMock.mockResolvedValue(jsonResponse({ version: "build-b" }));
    renderNotice();
    await focusTab();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
