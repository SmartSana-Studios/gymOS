import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, cleanPageText, cleanServicesText } from "@gymos/types";
import {
  aboutCharacters,
  cleanForm,
  copyMondayToAll,
  firstErrorLanguage,
  initialForm,
  isSaveInputValid,
  parseCoordinate,
  languagesWithErrors,
  removeLanguageInput,
  toSaveInput,
  validateForm,
  type EditorFormState,
} from "./pageEditorForm";

const stored = {
  about: { en: "", fr: "" },
  services: { en: "", fr: "" },
  address: "",
  lat: "",
  lng: "",
  hours: null,
  contactPhone: "",
  contactWhatsapp: "",
};

function form(over: Partial<EditorFormState> = {}): EditorFormState {
  return { ...initialForm(stored, [{ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", isPublic: false }]), ...over };
}

describe("cleaning pasted text", () => {
  it("turns CRLF and a lone CR into LF in About, Services and address, and drops control characters", () => {
    const f = cleanForm(form({ about: { en: "a\r\nb\rc", fr: "x\u0001y" }, services: { en: "one\r\ntwo", fr: "" }, address: "Rue 1\r\nBP 2" }));
    expect(f.about.en).toBe("a\nb\nc");
    expect(f.about.fr).toBe("xy");
    expect(f.services.en).toBe("one\ntwo");
    expect(f.address).toBe("Rue 1\nBP 2");
  });

  it("the save input carries LF only (matrix row: pasted Windows text)", () => {
    const input = toSaveInput(form({ about: { en: "line one\r\nline two", fr: "" } })) as { content: Record<string, unknown> };
    expect(input.content.about_en).toBe("line one\nline two");
    expect(JSON.stringify(input)).not.toContain("\\r");
  });

  it("keeps tab and line feed", () => {
    expect(cleanForm(form({ address: "a\tb\nc" })).address).toBe("a\tb\nc");
  });
});

describe("inline validation", () => {
  it("names the field and the language for < and >", () => {
    const e = validateForm(form({ about: { en: "ok", fr: "a < b" }, services: { en: "x > y", fr: "" }, address: "<" }));
    expect(e["about.fr"]).toEqual({ code: "angle", field: "about", lang: "fr" });
    expect(e["services.en"]).toEqual({ code: "angle", field: "services", lang: "en" });
    expect(e.address).toEqual({ code: "angle", field: "address", lang: undefined });
    expect(e["about.en"]).toBeUndefined();
  });

  it("counts code points, not UTF-16 units", () => {
    expect(validateForm(form({ about: { en: "😀".repeat(2000), fr: "" } }))["about.en"]).toBeUndefined();
    expect(validateForm(form({ about: { en: "😀".repeat(2001), fr: "" } }))["about.en"]?.code).toBe("tooLong");
    expect(aboutCharacters("  " + "😀".repeat(3) + "  ")).toBe(3);
  });

  it("map position: both or neither, in range, numeric", () => {
    expect(validateForm(form({ lat: "4.05" })).latlng?.code).toBe("latlngPair");
    expect(validateForm(form({ lng: "9.7" })).latlng?.code).toBe("latlngPair");
    expect(validateForm(form({ lat: "4.05", lng: "9.7" })).latlng).toBeUndefined();
    expect(validateForm(form({ lat: "91", lng: "9.7" })).latlng?.code).toBe("latlngRange");
    expect(validateForm(form({ lat: "4", lng: "181" })).latlng?.code).toBe("latlngRange");
    expect(validateForm(form({ lat: "abc", lng: "9" })).latlng?.code).toBe("latlngNumber");
  });

  it("phones are E.164 or empty", () => {
    expect(validateForm(form({ phone: "+237600111222", whatsapp: "" })).contact_phone).toBeUndefined();
    expect(validateForm(form({ phone: "600111222" })).contact_phone?.code).toBe("phone");
    expect(validateForm(form({ whatsapp: "+0123" })).contact_whatsapp?.code).toBe("phone");
  });

  it("an open day needs different times; a closed day is not judged", () => {
    const f = form();
    f.hours.mon = { closed: false, open: "06:00", close: "06:00" };
    expect(validateForm(f)["hours.mon"]?.code).toBe("hoursEqual");
    f.hours.mon = { closed: false, open: "6am", close: "22:00" };
    expect(validateForm(f)["hours.mon"]?.code).toBe("hoursTime");
    f.hours.mon = { closed: true, open: "06:00", close: "06:00" };
    expect(validateForm(f)["hours.mon"]).toBeUndefined();
  });

  it("finds the first language tab with an error", () => {
    const e = validateForm(form({ about: { en: "", fr: "<" }, services: { en: "", fr: "" } }));
    expect(firstErrorLanguage(e)).toBe("fr");
    expect([...languagesWithErrors(e)]).toEqual(["fr"]);
    expect(firstErrorLanguage({})).toBeNull();
  });
});

describe("the save input", () => {
  it("is valid for a clean form and carries one switch per plan", () => {
    const input = toSaveInput(form({ phone: "+237600111222" }));
    expect(isSaveInputValid(input)).toBe(true);
    expect((input as { plans: unknown[] }).plans).toEqual([{ plan_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", is_public: false }]);
  });

  it("has a key for every content language", () => {
    const { content } = toSaveInput(form()) as { content: Record<string, unknown> };
    for (const l of PAGE_CONTENT_LANGUAGES) {
      expect(content).toHaveProperty(`about_${l}`);
      expect(content).toHaveProperty(`services_${l}`);
    }
  });

  it("sends hours: null when every day is closed, and null per closed day otherwise", () => {
    expect((toSaveInput(form()) as { content: { hours: unknown } }).content.hours).toBeNull();
    const f = form();
    f.hours.tue = { closed: false, open: "07:00", close: "20:00" };
    const hours = (toSaveInput(f) as { content: { hours: Record<string, unknown> } }).content.hours;
    expect(hours.tue).toEqual({ open: "07:00", close: "20:00" });
    expect(hours.mon).toBeNull();
    expect(Object.keys(hours)).toHaveLength(7);
  });

  it("sends coordinates as numbers or null, and empty phones as empty strings (which clear)", () => {
    const c = (toSaveInput(form({ lat: "4.05", lng: "9.7" })) as { content: Record<string, unknown> }).content;
    expect(c.lat).toBe(4.05);
    expect(c.lng).toBe(9.7);
    const d = (toSaveInput(form()) as { content: Record<string, unknown> }).content;
    expect(d.lat).toBeNull();
    expect(d.contact_phone).toBe("");
  });

  it("removing a language clears its two fields only", () => {
    expect(removeLanguageInput("fr")).toEqual({ content: { about_fr: null, services_fr: null } });
    expect(isSaveInputValid(removeLanguageInput("fr"))).toBe(true);
  });
});

describe("hours helpers", () => {
  it("copies Monday to every day, closed state included", () => {
    const f = form();
    f.hours.mon = { closed: false, open: "08:00", close: "18:00" };
    const g = copyMondayToAll(f);
    expect(Object.values(g.hours).every((d) => !d.closed && d.open === "08:00" && d.close === "18:00")).toBe(true);
    f.hours.mon = { closed: true, open: "08:00", close: "18:00" };
    expect(Object.values(copyMondayToAll(f).hours).every((d) => d.closed)).toBe(true);
  });

  it("builds from stored hours: a stored day is open, a null or missing day is closed", () => {
    const f = initialForm({ ...stored, hours: { mon: { open: "06:00", close: "22:00" }, sun: null } }, []);
    expect(f.hours.mon.closed).toBe(false);
    expect(f.hours.sun.closed).toBe(true);
    expect(f.hours.wed.closed).toBe(true);
  });
});

describe("coordinates", () => {
  it.each([
    ["4.05", 4.05],
    ["-9.7", -9.7],
    ["12", 12],
    ["  4,05 ", 4.05],
    ["-4,5", -4.5],
    ["0.000001", 0.000001],
  ])("%j is accepted as %s (a decimal comma counts as a point)", (input, expected) => expect(parseCoordinate(input)).toBe(expected));

  it.each(["1e1", "0x10", "+4", "4.", ".5", "4..5", "4,5,6", "1_000", "Infinity", "NaN", "4 5", "", "--4"])("%j is refused", (input) => expect(parseCoordinate(input)).toBeNull());

  it("the form accepts a decimal comma and sends the number", () => {
    const f = form({ lat: "4,05", lng: "9,7" });
    expect(validateForm(f).latlng).toBeUndefined();
    const c = (toSaveInput(f) as { content: Record<string, unknown> }).content;
    expect([c.lat, c.lng]).toEqual([4.05, 9.7]);
  });

  it.each([["1e1", "9"], ["4", "0x10"], ["+4", "9"]])("the form refuses lat %j / lng %j", (lat, lng) => {
    expect(validateForm(form({ lat, lng })).latlng?.code).toBe("latlngNumber");
  });
});

describe("Services bullet markers", () => {
  it.each([
    ["- Free weights", "Free weights"],
    ["  -   Cardio", "Cardio"],
    ["\u2013 Yoga", "Yoga"],
    ["\u2014 Boxing", "Boxing"],
    ["\u2022 Sauna", "Sauna"],
    ["* Showers", "Showers"],
    ["\u00b7 Lockers", "Lockers"],
    ["-\tCrossfit", "Crossfit"],
  ])("drops the marker of %j", (line, want) => {
    expect(cleanServicesText(line)).toBe(want);
  });

  it("drops one marker per line, keeps the other lines and a lone marker becomes an empty line", () => {
    expect(cleanServicesText("- one\n- two\r\n\u2022 three\n-\nfour")).toBe("one\ntwo\nthree\n\nfour");
    expect(cleanServicesText("- - nested")).toBe("- nested");
  });

  it.each(["Free weights", "-5 kg plates", "24/7 access", "1. Cardio", "A - B", "Wi-Fi", "--flag", "\u2013 "])("leaves %j alone (no marker followed by a space)", (line) => {
    expect(cleanServicesText(line)).toBe(line === "\u2013 " ? "" : line);
  });

  it("the editor field and the save input carry the cleaned Services, About keeps its dashes", () => {
    const f = cleanForm(form({ about: { en: "- about stays", fr: "" }, services: { en: "- one\n- two", fr: "\u2022 un" } }));
    expect(f.services.en).toBe("one\ntwo");
    expect(f.services.fr).toBe("un");
    expect(f.about.en).toBe("- about stays");
    const input = toSaveInput(f) as { content: Record<string, unknown> };
    expect(input.content.services_en).toBe("one\ntwo");
  });
});

describe("cleanPageText: the range is generated from the gate's character class", () => {
  // private.gym_page_gate_missing rejects [<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]; the editor must remove those, and keep tab and line feed.
  const inGateClass = (cp: number) => (cp >= 0x01 && cp <= 0x08) || (cp >= 0x0b && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);

  it("every code point from U+0000 to U+00A0 is removed, kept or converted as the gate class says", () => {
    for (let cp = 0; cp <= 0xa0; cp++) {
      const ch = String.fromCodePoint(cp);
      const out = cleanPageText(`a${ch}b`);
      if (cp === 0x0d) expect(out, "CR becomes LF").toBe("a\nb");
      else if (cp === 0x00 || inGateClass(cp)) expect(out, `U+${cp.toString(16).padStart(4, "0")} removed`).toBe("ab");
      else expect(out, `U+${cp.toString(16).padStart(4, "0")} kept`).toBe(`a${ch}b`);
    }
  });

  it("pins the edges: U+0085 and U+007F go, tab and line feed stay, U+00A0 stays", () => {
    expect(cleanPageText("a\u0085b")).toBe("ab");
    expect(cleanPageText("a\u007fb")).toBe("ab");
    expect(cleanPageText("a\u009fb")).toBe("ab");
    expect(cleanPageText("a\tb\nc")).toBe("a\tb\nc");
    expect(cleanPageText("a\u00a0b")).toBe("a\u00a0b");
  });

  it("the cleaned output never trips the gate's character class (except < and >, which validation refuses)", () => {
    const all = Array.from({ length: 0xa1 }, (_, i) => String.fromCodePoint(i)).join("");
    expect(cleanPageText(all)).not.toMatch(/[\u0001-\u0008\u000b-\u001f\u007f-\u009f]/);
  });
});
