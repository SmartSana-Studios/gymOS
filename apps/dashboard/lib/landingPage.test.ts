import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_BAD_TEXT_FIELDS,
  PAGE_CONTENT_ERROR_CODES,
  PAGE_CONTENT_LANGUAGES,
  PAGE_PUBLISH_GATE_CODES,
  PAGE_STATUS_STATES,
  gymPageStatusSchema,
  type GymPageStatus,
  type PageContentLanguage,
} from "@gymos/types";
import en from "../locales/en.json";
import fr from "../locales/fr.json";
import {
  CHECKLIST_ITEMS,
  GATE_CODE_ORDER,
  GATE_CODE_SECTION,
  PAGE_SECTION_IDS,
  badTextTarget,
  buildChecklist,
  gateCodeAnchor,
  initialShownLanguages,
  languageTabStatus,
  type LanguageProgress,
  pagePublicHost,
  pickTextTab,
  predictedBreaks,
  sortGateCodes,
  statusBannerCodes,
} from "./landingPage";
import { DEFAULT_PAGE_TEMPLATE, PAGE_TEMPLATES, isOfferedTemplate } from "./pageTemplates";

type Dict = Record<string, unknown>;
const get = (d: Dict, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], d);

describe("gate codes: every one has a phrase, a banner line, an anchor and an order", () => {
  it.each(PAGE_PUBLISH_GATE_CODES)("%s", (code) => {
    expect(GATE_CODE_SECTION[code], "section").toBeTruthy();
    expect(PAGE_SECTION_IDS[GATE_CODE_SECTION[code]], "section id").toBeTruthy();
    expect(gateCodeAnchor(code)).toMatch(/^#page-/);
    expect(GATE_CODE_ORDER).toContain(code);
    for (const [name, d] of [["en", en], ["fr", fr]] as const) {
      expect(get(d, `pageEditor.gate.${code}`), `${name} gate line`).toBeTruthy();
      expect(get(d, `pageEditor.gateItem.${code}`), `${name} publish-list line`).toBeTruthy();
    }
  });

  it("the order lists each code once and nothing else", () => {
    expect([...GATE_CODE_ORDER].sort()).toEqual([...PAGE_PUBLISH_GATE_CODES].sort());
  });

  it("the reason that is not a gate code has a line too", () => {
    expect(get(en, "pageEditor.gate.name_released")).toBeTruthy();
    expect(get(fr, "pageEditor.gate.name_released")).toBeTruthy();
  });

  it("the nine checklist items cover the gate codes that are items", () => {
    expect(CHECKLIST_ITEMS).toHaveLength(9);
    const covered = new Set<string>(CHECKLIST_ITEMS.flatMap((i) => [...i.codes]));
    expect([...PAGE_PUBLISH_GATE_CODES].filter((c) => !covered.has(c)).sort()).toEqual(["bad_text", "map_incomplete", "too_large"]);
  });

  it("sorts in checklist order with bad_text, map_incomplete and too_large last, once each", () => {
    expect(sortGateCodes(["too_large", "no_hours", "bad_text", "no_name", "no_hours", "map_incomplete", "about_short"])).toEqual([
      "no_name",
      "about_short",
      "no_hours",
      "map_incomplete",
      "bad_text",
      "too_large",
    ]);
  });
});

describe("copy exists in both locales", () => {
  it.each(PAGE_STATUS_STATES)("status %s", (s) => {
    expect(get(en, `pageEditor.status.${s}`)).toBeTruthy();
    expect(get(fr, `pageEditor.status.${s}`)).toBeTruthy();
  });
  it.each(PAGE_BAD_TEXT_FIELDS)("field %s", (f) => {
    expect(get(en, `pageEditor.fields.${f}`)).toBeTruthy();
    expect(get(fr, `pageEditor.fields.${f}`)).toBeTruthy();
  });
  it.each([...PAGE_CONTENT_ERROR_CODES, "load_failed"])("error %s", (c) => {
    expect(get(en, `pageEditor.errors.${c}`)).toBeTruthy();
    expect(get(fr, `pageEditor.errors.${c}`)).toBeTruthy();
  });
  it.each(PAGE_CONTENT_LANGUAGES)("language name %s", (l) => {
    expect(get(en, `pageEditor.languages.${l}`)).toBeTruthy();
    expect(get(fr, `pageEditor.languages.${l}`)).toBeTruthy();
  });
  it.each(CHECKLIST_ITEMS.map((i) => i.id))("checklist item %s", (id) => {
    expect(get(en, `pageEditor.checklist.items.${id}`)).toBeTruthy();
    expect(get(fr, `pageEditor.checklist.items.${id}`)).toBeTruthy();
  });
  it("a template name for every offered template", () => {
    for (const tpl of PAGE_TEMPLATES) {
      expect(get(en, `pageEditor.templates.${tpl}`)).toBeTruthy();
      expect(get(fr, `pageEditor.templates.${tpl}`)).toBeTruthy();
    }
  });
});

describe("pageEditor.* and pageMedia.errors.* key parity", () => {
  const flat = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o as Dict).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
  for (const ns of ["pageEditor", "pageMedia.errors"]) {
    it(`${ns}: the same keys in English and French`, () => {
      const a = flat(get(en, ns), ns).sort();
      const b = flat(get(fr, ns), ns).sort();
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
    });
  }
  it("pageMedia.errors covers every typed upload error", async () => {
    const { PAGE_MEDIA_ERROR_CODES } = await import("@gymos/types");
    for (const c of [...PAGE_MEDIA_ERROR_CODES, "noLogo", "uploadFailed"]) {
      expect(get(en, `pageMedia.errors.${c}`), c).toBeTruthy();
      expect(get(fr, `pageMedia.errors.${c}`), c).toBeTruthy();
    }
  });
  it("no empty strings", () => {
    for (const d of [en, fr]) for (const ns of ["pageEditor", "pageMedia.errors"]) for (const k of flat(get(d, ns), ns)) expect(get(d, k), k).not.toBe("");
  });
});

function status(over: Partial<GymPageStatus> = {}): GymPageStatus {
  return gymPageStatusSchema.parse({
    state: "in_progress",
    template: null,
    published_at: null,
    unpublished_reasons: [],
    missing: [],
    bad_text_fields: [],
    about_min_chars: 100,
    languages: PAGE_CONTENT_LANGUAGES.map((code) => ({ code, complete: false, characters: 0, needed: 100 })),
    media: [],
    snapshot: { name: "Gym", default_language: "en" },
    taken_down_reason: null,
    appeal: null,
    ...over,
  });
}

describe("checklist", () => {
  it("a fresh gym misses eight of nine (category is always set)", () => {
    const c = buildChecklist(status({ missing: ["no_name", "no_logo", "no_banner", "about_short", "no_city", "no_contact", "no_hours", "no_public_plan"] }));
    expect(c.total).toBe(9);
    expect(c.readyCount).toBe(c.rows.filter((r) => r.ready).length);
    expect(c.readyCount).toBe(1);
    expect(c.rows.filter((r) => !r.ready).map((r) => r.id)).toEqual(["name", "logo", "banner", "about", "location", "contact", "hours", "plan"]);
    expect(c.rows.find((r) => r.id === "location")?.missing).toEqual(["no_city"]);
  });

  it("everything met: nine of nine", () => {
    const c = buildChecklist(status());
    expect(c.readyCount).toBe(9);
  });

  it("content codes that are not items do not change the nine", () => {
    expect(buildChecklist(status({ missing: ["bad_text", "map_incomplete", "too_large"] })).readyCount).toBe(9);
  });
});

describe("status banner codes", () => {
  it("offline_gate lists the recorded reasons that still hold, in checklist order", () => {
    expect(statusBannerCodes({ state: "offline_gate", unpublished_reasons: ["bad_text", "no_banner", "no_logo"], missing: ["no_banner", "bad_text"] })).toEqual(["no_banner", "bad_text"]);
  });
  it("name released is its own line", () => {
    expect(statusBannerCodes({ state: "offline_name_released", unpublished_reasons: ["name_released"], missing: ["no_name"] })).toEqual(["name_released"]);
  });
  it("other states show no banner", () => {
    for (const s of PAGE_STATUS_STATES.filter((x) => x !== "offline_gate" && x !== "offline_name_released")) {
      expect(statusBannerCodes({ state: s, unpublished_reasons: ["no_logo"], missing: ["no_logo"] })).toEqual([]);
    }
  });
});

describe("bad text targets", () => {
  it("a gym name is fixed in Settings, a plan name on the Plans page, the rest in the editor", () => {
    expect(badTextTarget("gym_name")).toEqual({ kind: "settings", href: "/settings" });
    expect(badTextTarget("plan_name").kind).toBe("plans");
    expect(badTextTarget("about")).toEqual({ kind: "anchor", href: "#page-text" });
    expect(badTextTarget("address")).toEqual({ kind: "anchor", href: "#page-location" });
  });
});

describe("language tabs", () => {
  it("status per tab", () => {
    expect(languageTabStatus({ code: "fr", characters: 100, hasText: true }, 100)).toEqual({ status: "complete", needed: 0 });
    expect(languageTabStatus({ code: "fr", characters: 68, hasText: true }, 100)).toEqual({ status: "needs", needed: 32 });
    expect(languageTabStatus({ code: "fr", characters: 0, hasText: false }, 100).status).toBe("empty");
    expect(languageTabStatus({ code: "fr", characters: 0, hasText: true }, 100)).toEqual({ status: "needs", needed: 100 });
  });

  const progress = (en_: number, fr_: number) =>
    new Map<PageContentLanguage, LanguageProgress>([
      ["en", { code: "en", characters: en_, hasText: en_ > 0 }],
      ["fr", { code: "fr", characters: fr_, hasText: fr_ > 0 }],
    ]);

  it("links open the default tab, the first incomplete tab when the default is complete, the default when all are complete", () => {
    expect(pickTextTab(["en", "fr"], progress(10, 200), "en", 100)).toBe("en");
    expect(pickTextTab(["en", "fr"], progress(200, 30), "en", 100)).toBe("fr");
    expect(pickTextTab(["en", "fr"], progress(200, 200), "en", 100)).toBe("en");
    expect(pickTextTab(["en"], progress(200, 0), "en", 100)).toBe("en");
  });

  it("a fresh editor shows the default language only; saved text adds a tab", () => {
    const saved = new Map([["fr" as const, { about: "", services: "" }], ["en" as const, { about: "", services: "" }]]);
    expect(initialShownLanguages(PAGE_CONTENT_LANGUAGES, "en", saved)).toEqual(["en"]);
    expect(initialShownLanguages(PAGE_CONTENT_LANGUAGES, "fr", saved)).toEqual(["fr"]);
    saved.set("fr", { about: "", services: "Yoga" });
    expect(initialShownLanguages(PAGE_CONTENT_LANGUAGES, "en", saved)).toEqual(["en", "fr"]);
  });
});

describe("predicted breaks on a live page", () => {
  const base = { state: "published" as const, publicPlanCount: 1, longestAbout: 120, minAbout: 100, city: "Douala", hasContact: true, hasOpenDay: true };
  it("nothing breaks when everything stays", () => expect(predictedBreaks(base).codes).toEqual([]));
  it("the last public plan off (matrix row)", () => expect(predictedBreaks({ ...base, publicPlanCount: 0 }).codes).toEqual(["no_public_plan"]));
  it("no complete language, no contact, no hours, no city", () => {
    expect(predictedBreaks({ ...base, longestAbout: 99, hasContact: false, hasOpenDay: false, city: " " }).codes).toEqual(["about_short", "no_city", "no_contact", "no_hours"]);
  });
  it("a page that is not live is never warned", () => {
    expect(predictedBreaks({ ...base, state: "ready", publicPlanCount: 0 }).codes).toEqual([]);
  });
});

describe("templates and address", () => {
  it("the offered templates, from one constant module", () => {
    expect(PAGE_TEMPLATES).toEqual(["classic", "volt"]);
    expect(DEFAULT_PAGE_TEMPLATE).toBe("classic");
    expect(isOfferedTemplate("classic")).toBe(true);
    expect(isOfferedTemplate("volt")).toBe(true);
    expect(isOfferedTemplate("bold")).toBe(false);
    expect(isOfferedTemplate(null)).toBe(false);
  });
  it("the public address is name.gymosapps.com", () => {
    expect(pagePublicHost("grace-fit")).toBe("grace-fit.gymosapps.com");
  });
  it("the editor sources hard-code no EN/FR pair of content languages", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "(dashboard)", "settings", "landing-page");
    // a loose check over the shipped component sources: the language pair must come from PAGE_CONTENT_LANGUAGES.
    // A missing file throws, so a renamed component cannot make this check pass by skipping it.
    const files = ["components/PageTextSection.tsx", "components/PublishScreen.tsx", "components/Checklist.tsx", "components/LandingPageEditor.tsx", "components/pageCopy.ts"];
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/\[\s*["']en["']\s*,\s*["']fr["']\s*\]/);
    }
  });
});
