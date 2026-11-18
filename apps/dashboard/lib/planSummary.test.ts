/**
 * Story 27.4 (FR-240, UX AD-23): the one plan summary line, against the real EN and FR strings. An annual plan says "Paid once"; a
 * monthly plan keeps "[price] XAF · [D] days"; Pay-per-session reads "[price] XAF / session"; a plan row without a price falls back to its
 * name; the Plans list row for an annual plan has no "/ annual" suffix.
 */
import { describe, expect, it } from "vitest";

import { realT } from "@/test-utils/realT";
import { annualListLine, isPaidOncePlan, planNameWithSummary, planOptionLabel, planSummaryLine } from "./planSummary";

const ANNUAL = { planType: "monthly", price: 250000, durationDays: 365, billingInterval: "annual" };
const MONTHLY = { planType: "monthly", price: 25000, durationDays: 30, billingInterval: "monthly" };
const PPS = { planType: "pay_per_session", price: 2000, durationDays: null, billingInterval: "monthly" };

// "250,000" in English, "250 000" (a narrow no-break space) in French: compare after normalising spaces.
const flat = (text: string | null) => (text ?? "").replace(/[  ]/g, " ");

describe("plan summary line", () => {
  it("annual: price, duration and Paid once (EN)", () => {
    expect(planSummaryLine(realT("en"), ANNUAL, "en")).toBe("250,000 XAF · 365 days · Paid once");
  });

  it("annual: the French wording", () => {
    expect(flat(planSummaryLine(realT("fr"), ANNUAL, "fr"))).toBe("250 000 XAF · 365 jours · Payé en une fois");
  });

  it("monthly keeps price and duration, with no Paid once", () => {
    expect(planSummaryLine(realT("en"), MONTHLY, "en")).toBe("25,000 XAF · 30 days");
    expect(flat(planSummaryLine(realT("fr"), MONTHLY, "fr"))).toBe("25 000 XAF · 30 jours");
  });

  it("Pay-per-session reads per session", () => {
    expect(planSummaryLine(realT("en"), PPS, "en")).toBe("2,000 XAF / session");
    expect(flat(planSummaryLine(realT("fr"), PPS, "fr"))).toBe("2 000 XAF / séance");
  });

  it("'Paid once' follows the billing interval, not the length of the plan", () => {
    expect(isPaidOncePlan({ planType: "monthly", billingInterval: "annual" })).toBe(true);
    expect(isPaidOncePlan({ planType: "monthly", billingInterval: "monthly" })).toBe(false);
    expect(isPaidOncePlan({ planType: "pay_per_session", billingInterval: "annual" })).toBe(false);
    // A 365-day plan billed monthly is not "Paid once".
    expect(planSummaryLine(realT("en"), { ...MONTHLY, durationDays: 365 }, "en")).toBe("25,000 XAF · 365 days");
  });

  it("a select option is the name then the summary line; a plan with no price shows its name alone", () => {
    expect(planOptionLabel(realT("en"), { name: "ANNUAL", ...ANNUAL }, "en")).toBe("ANNUAL · 250,000 XAF · 365 days · Paid once");
    expect(planOptionLabel(realT("en"), { name: "ANNUAL" }, "en")).toBe("ANNUAL");
  });

  it("the plan name area reads 'Annual (250,000 XAF · 365 days · Paid once)'", () => {
    expect(planNameWithSummary(realT("en"), { name: "ANNUAL", ...ANNUAL }, "en")).toBe("ANNUAL (250,000 XAF · 365 days · Paid once)");
  });

  it("the Plans list row for an annual plan is 'XAF 250,000 · 365 days · Paid once' with no '/ annual' suffix", () => {
    const line = annualListLine(realT("en"), ANNUAL, "en");
    expect(line).toBe("XAF 250,000 · 365 days · Paid once");
    expect(line).not.toMatch(/\/\s*annual/i);
    expect(flat(annualListLine(realT("fr"), ANNUAL, "fr"))).toBe("250 000 XAF · 365 jours · Payé en une fois");
    expect(annualListLine(realT("en"), MONTHLY, "en")).toBeNull();
    expect(annualListLine(realT("en"), PPS, "en")).toBeNull();
  });
});
