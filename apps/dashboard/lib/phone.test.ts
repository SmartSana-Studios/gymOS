import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHONE_COUNTRY,
  isSupportedPhoneCountry,
  normalizePhoneForCountry,
  phoneCountryCallingCode,
  resolvePhoneCountry,
} from "./phone";

describe("normalizePhoneForCountry", () => {
  it("reads a bare national number against the gym's country", () => {
    expect(normalizePhoneForCountry("670123456", "CM")).toBe("+237670123456");
    expect(normalizePhoneForCountry("8031234567", "NG")).toBe("+2348031234567");
  });

  it("ignores spaces, dots, dashes and parentheses", () => {
    expect(normalizePhoneForCountry(" 6 70-12.34 56 ", "CM")).toBe("+237670123456");
    expect(normalizePhoneForCountry("+237 (670) 123 456", "CM")).toBe("+237670123456");
  });

  it("keeps a number that already names its own country, whatever the gym's", () => {
    expect(normalizePhoneForCountry("+2348031234567", "CM")).toBe("+2348031234567");
    expect(normalizePhoneForCountry("+237670123456", "NG")).toBe("+237670123456");
  });

  it("reads the 00 international prefix as +", () => {
    expect(normalizePhoneForCountry("00237670123456", "NG")).toBe("+237670123456");
  });

  it("accepts a number whose + was stripped (Excel)", () => {
    expect(normalizePhoneForCountry("237670123456", "CM")).toBe("+237670123456");
  });

  it("returns an invalid number unchanged so the E.164 schema rejects it", () => {
    expect(normalizePhoneForCountry("12345", "CM")).toBe("12345");
    expect(normalizePhoneForCountry("abc", "CM")).toBe("abc");
    expect(normalizePhoneForCountry("+999123", "CM")).toBe("+999123");
  });

  it("returns an empty cell as empty", () => {
    expect(normalizePhoneForCountry("   ", "CM")).toBe("");
  });
});

describe("country helpers", () => {
  it("recognizes ISO codes libphonenumber supports and rejects the rest", () => {
    expect(isSupportedPhoneCountry("CM")).toBe(true);
    expect(isSupportedPhoneCountry("cm")).toBe(false);
    expect(isSupportedPhoneCountry("ZZ")).toBe(false);
  });

  it("falls back to the default for a missing or unknown stored country", () => {
    expect(resolvePhoneCountry("NG")).toBe("NG");
    expect(resolvePhoneCountry(null)).toBe(DEFAULT_PHONE_COUNTRY);
    expect(resolvePhoneCountry("ZZ")).toBe(DEFAULT_PHONE_COUNTRY);
  });

  it("formats the calling code with a leading +", () => {
    expect(phoneCountryCallingCode("CM")).toBe("+237");
  });
});
