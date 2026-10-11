/**
 * Story 19.9a review: the turn-off dialog interpolates the validity days with
 * i18next plural keys. The form test mocks `t`, so resolve the real locale
 * files here -- a missing `offKept_one` would otherwise ship "1 days".
 */
import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import appEn from "../../locales/en.json";
import appFr from "../../locales/fr.json";

async function translator(lng: "en" | "fr") {
  const instance = createInstance();
  await instance.init({
    lng,
    fallbackLng: "en",
    resources: { en: { translation: appEn }, fr: { translation: appFr } },
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance);
}

describe("settings.guestCharging.offKept plurals", () => {
  it("resolves the singular for 1 and the plural for 7 in EN", async () => {
    const t = await translator("en");
    expect(t("settings.guestCharging.offKept", { count: 1 })).toContain("lapse 1 day after payment");
    expect(t("settings.guestCharging.offKept", { count: 7 })).toContain("lapse 7 days after payment");
  });

  it("resolves the singular for 1 and the plural for 7 in FR", async () => {
    const t = await translator("fr");
    expect(t("settings.guestCharging.offKept", { count: 1 })).toContain("1 jour après");
    expect(t("settings.guestCharging.offKept", { count: 7 })).toContain("7 jours après");
  });
});
