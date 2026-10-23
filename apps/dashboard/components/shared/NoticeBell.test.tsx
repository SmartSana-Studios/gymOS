/** Story 23.9: the Owner's header bell shows the unread count and the notice in the viewer's language. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getStaffNoticesAction = vi.fn();
const markStaffNoticesReadAction = vi.fn(async () => ({ error: null }));
vi.mock("@/app/(dashboard)/actions", () => ({
  getStaffNoticesAction: () => getStaffNoticesAction(),
  markStaffNoticesReadAction: () => markStaffNoticesReadAction(),
}));
const lang = { value: "en" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key),
    i18n: { language: lang.value },
  }),
}));

import { NoticeBell } from "./NoticeBell";

afterEach(() => {
  cleanup();
  getStaffNoticesAction.mockReset();
  markStaffNoticesReadAction.mockClear();
  lang.value = "en";
});

const NOTICE = {
  id: "n1", noticeType: "payment_connection_changed",
  titleEn: "GymOS Support updated your payment account", titleFr: "GymOS Support a mis à jour votre compte de paiement",
  bodyEn: "body en", bodyFr: "body fr", createdAt: "2026-10-21T10:00:00Z", readAt: null,
};

describe("NoticeBell", () => {
  it("shows the unread count on the bell", async () => {
    getStaffNoticesAction.mockResolvedValue({ data: { notices: [NOTICE], unread: 3 }, error: null });
    render(<NoticeBell />);
    await waitFor(() => expect(screen.getByTestId("notice-unread-count").textContent).toBe("3"));
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("notices.bellLabelUnread:3");
  });

  it("shows no badge when everything is read", async () => {
    getStaffNoticesAction.mockResolvedValue({ data: { notices: [{ ...NOTICE, readAt: "x" }], unread: 0 }, error: null });
    render(<NoticeBell />);
    await waitFor(() => expect(getStaffNoticesAction).toHaveBeenCalled());
    expect(screen.queryByTestId("notice-unread-count")).toBeNull();
  });

  it("survives a failed load without a badge", async () => {
    getStaffNoticesAction.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    render(<NoticeBell />);
    await waitFor(() => expect(getStaffNoticesAction).toHaveBeenCalled());
    expect(screen.queryByTestId("notice-unread-count")).toBeNull();
  });

  it("opening the list marks read once, using the count the open itself just loaded", async () => {
    // the poll saw 0 unread, but a notice arrived before the click: the load on open returns 1
    getStaffNoticesAction.mockResolvedValueOnce({ data: { notices: [], unread: 0 }, error: null });
    getStaffNoticesAction.mockResolvedValue({ data: { notices: [NOTICE], unread: 1 }, error: null });
    render(<NoticeBell />);
    await waitFor(() => expect(getStaffNoticesAction).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(markStaffNoticesReadAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("notice-unread-count")).toBeNull());
  });

  it("opening with nothing unread marks nothing", async () => {
    getStaffNoticesAction.mockResolvedValue({ data: { notices: [{ ...NOTICE, readAt: "x" }], unread: 0 }, error: null });
    render(<NoticeBell />);
    await userEvent.click(screen.getByRole("button"));
    await screen.findByText("GymOS Support updated your payment account");
    expect(markStaffNoticesReadAction).not.toHaveBeenCalled();
  });

  it("shows French titles and bodies when the language is French", async () => {
    lang.value = "fr";
    getStaffNoticesAction.mockResolvedValue({ data: { notices: [NOTICE], unread: 1 }, error: null });
    render(<NoticeBell />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("GymOS Support a mis à jour votre compte de paiement")).toBeTruthy();
    expect(screen.getByText("body fr")).toBeTruthy();
    expect(screen.queryByText("body en")).toBeNull();
  });
});
