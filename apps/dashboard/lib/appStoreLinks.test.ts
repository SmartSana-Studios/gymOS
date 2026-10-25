import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import fr from "../locales/fr.json";
import { APP_STORE_URL, PLAY_STORE_URL } from "./appStoreLinks";

describe("member invite store links", () => {
  it("point at the published store listings", () => {
    expect(APP_STORE_URL).toMatch(/^https:\/\/apps\.apple\.com\/app\/id\d+$/);
    expect(PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.smartsana.gymos");
  });

  it.each([["en", en], ["fr", fr]] as const)("the %s invite message carries both links", (_lang, locale) => {
    const message = (locale as { members: { invite: { message: string } } }).members.invite.message;
    expect(message).toContain("{{appStoreUrl}}");
    expect(message).toContain("{{playStoreUrl}}");
    expect(message).toContain("{{gymName}}");
  });
});
