import { describe, expect, it } from "vitest";
import { DEFAULT_WEBSITE_CONTACT_EMAIL, websiteContact, websiteEmailHref, websiteWhatsappHref } from "./websiteContact";

describe("websiteContact", () => {
  it("defaults to the marketing site's address and no WhatsApp", () => {
    expect(websiteContact({})).toEqual({ email: DEFAULT_WEBSITE_CONTACT_EMAIL, whatsapp: "" });
    expect(DEFAULT_WEBSITE_CONTACT_EMAIL).toBe("hello@gymosapps.com");
  });

  it("takes the configured address (trimmed) and keeps only the digits of the WhatsApp number", () => {
    expect(websiteContact({ email: "  sales@example.test ", whatsapp: "+237 670-00 00 00" })).toEqual({ email: "sales@example.test", whatsapp: "237670000000" });
  });

  it("a blank address falls back to the default", () => {
    expect(websiteContact({ email: "   " }).email).toBe(DEFAULT_WEBSITE_CONTACT_EMAIL);
  });

  it("builds an encoded mailto link", () => {
    const href = websiteEmailHref({ email: "a@b.test", whatsapp: "" }, "Custom site & more", "Hello, I'd like it");
    expect(href).toBe("mailto:a@b.test?subject=Custom%20site%20%26%20more&body=Hello%2C%20I'd%20like%20it");
  });

  it("builds a wa.me link only when a number exists, never wa.me/undefined", () => {
    expect(websiteWhatsappHref({ email: "a@b.test", whatsapp: "237670000000" }, "Hi there")).toBe("https://wa.me/237670000000?text=Hi%20there");
    expect(websiteWhatsappHref({ email: "a@b.test", whatsapp: "" }, "Hi")).toBeNull();
  });
});
