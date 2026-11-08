/**
 * Story 24.7: the Zod mirror of the page name grammar (claim_page_name(), migration 0163) and the copy for its typed errors.
 * The database re-validates every rule; these tests pin the client-side copy and the EN/FR messages.
 */
import { describe, expect, it } from "vitest";
import { PAGE_NAME_ERROR_CODES, claimPageNameSchema, isValidPageName, pageNameSchema } from "@gymos/types";
import en from "../locales/en.json";
import fr from "../locales/fr.json";

describe("page name grammar", () => {
  it("accepts valid names", () => {
    for (const ok of ["abc", "a1b", "iron-yard", "a".repeat(30), "1a2"]) expect(isValidPageName(ok), ok).toBe(true);
  });

  it("refuses the grammar cases the database refuses", () => {
    for (const bad of ["ab", "-abc", "abc-", "a--b", "xn--abc", "12345", "ABC", "ab_c", "ab c", "a".repeat(31), "a.b", ""]) {
      expect(isValidPageName(bad), bad).toBe(false);
    }
  });

  it("trims and lowercases before checking, as the database does", () => {
    expect(pageNameSchema.parse("  Iron-Yard ")).toBe("iron-yard");
    expect(pageNameSchema.safeParse("  A ").success).toBe(false);
  });

  it("trims Unicode whitespace (NBSP, ideographic space, BOM) like the database", () => {
    expect(pageNameSchema.parse(" iron-yard　")).toBe("iron-yard");
    expect(pageNameSchema.parse("﻿iron-yard ")).toBe("iron-yard");
  });

  it("claimPageNameSchema needs a gym id and a valid name and nothing else", () => {
    const gymId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(claimPageNameSchema.safeParse({ gymId, name: "iron-yard" }).success).toBe(true);
    expect(claimPageNameSchema.safeParse({ gymId, name: "iron-yard", extra: 1 }).success).toBe(false);
    expect(claimPageNameSchema.safeParse({ gymId: "x", name: "iron-yard" }).success).toBe(false);
  });
});

describe("page name error copy", () => {
  it.each(PAGE_NAME_ERROR_CODES)("%s has English and French copy", (code) => {
    expect((en.pageNames.errors as Record<string, string>)[code]).toBeTruthy();
    expect((fr.pageNames.errors as Record<string, string>)[code]).toBeTruthy();
  });

  it("the under-review status has English and French copy", () => {
    expect(en.pageNames.status.held).toBeTruthy();
    expect(fr.pageNames.status.held).toBeTruthy();
  });
});
