import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import fr from "../locales/fr.json";

// The owner's welcome message is read on a phone: the link, the phone and the password must each sit on their own
// line, not run together in one block.
describe.each([["en", en], ["fr", fr]] as const)("owner welcome message (%s)", (_lang, locale) => {
  const message = (locale as { gyms: { ownerWelcome: { message: string } } }).gyms.ownerWelcome.message;
  const lines = message.split("\n");

  it("has line breaks, with blank lines between the paragraphs", () => {
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.filter((l) => l === "").length).toBeGreaterThanOrEqual(3);
  });

  it("puts the sign-in link, the phone and the temporary password each on their own line", () => {
    expect(lines.some((l) => l.includes("{{url}}") && !l.includes("{{phone}}") && !l.includes("{{password}}"))).toBe(true);
    expect(lines.some((l) => l.includes("{{phone}}") && !l.includes("{{url}}") && !l.includes("{{password}}"))).toBe(true);
    expect(lines.some((l) => l.includes("{{password}}") && !l.includes("{{url}}") && !l.includes("{{phone}}"))).toBe(true);
  });

  it("names the owner and the gym", () => {
    expect(message).toContain("{{ownerName}}");
    expect(message).toContain("{{gymName}}");
  });
});
