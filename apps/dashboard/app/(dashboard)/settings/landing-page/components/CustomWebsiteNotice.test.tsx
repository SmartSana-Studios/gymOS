/** The "need a custom website?" notice: email always, WhatsApp only when a number is configured. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { CustomWebsiteNotice } from "./CustomWebsiteNotice";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CustomWebsiteNotice", () => {
  it("banner: says it, links the default address, and has NO WhatsApp link without a number", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "");
    render(<CustomWebsiteNotice variant="banner" />);
    const note = screen.getByTestId("custom-website-notice");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toContain("pageEditor.customSite.title");
    expect(note.textContent).toContain("pageEditor.customSite.body");
    const email = screen.getByTestId("custom-website-email");
    expect(email.getAttribute("href")).toMatch(/^mailto:hello@gymosapps\.com\?subject=/);
    expect(email.textContent).toBe("hello@gymosapps.com");
    expect(screen.queryByTestId("custom-website-whatsapp")).toBeNull();
  });

  it("banner: with a configured number there is a WhatsApp link that opens safely in a new tab", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "+237 670 000 000");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "sales@example.test");
    render(<CustomWebsiteNotice variant="banner" />);
    const wa = screen.getByTestId("custom-website-whatsapp");
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/237670000000\?text=/);
    expect(wa.getAttribute("target")).toBe("_blank");
    expect(wa.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByTestId("custom-website-email").getAttribute("href")).toMatch(/^mailto:sales@example\.test\?/);
  });

  it("inline: one short line with the same links", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "237670000000");
    render(<CustomWebsiteNotice variant="inline" />);
    const line = screen.getByTestId("custom-website-inline");
    expect(line.textContent).toContain("pageEditor.customSite.body");
    expect(screen.getByTestId("custom-website-email")).toBeTruthy();
    expect(screen.getByTestId("custom-website-whatsapp")).toBeTruthy();
    expect(screen.queryByTestId("custom-website-notice")).toBeNull();
  });
});
