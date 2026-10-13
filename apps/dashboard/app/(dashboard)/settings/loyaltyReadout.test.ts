import { describe, expect, it } from "vitest";
import {
  guestDiscountPercent,
  parseLoyaltyNumber,
  subscriberDiscountPercent,
  subscriberReadoutLines,
} from "./loyaltyReadout";

describe("loyalty readout helpers", () => {
  it("computes the guest discount", () => {
    expect(guestDiscountPercent(5)).toBe(17);
    expect(guestDiscountPercent(2)).toBe(33);
    expect(guestDiscountPercent(50)).toBe(2);
  });

  it("computes the subscriber discount", () => {
    expect(subscriberDiscountPercent(3, 30, 30)).toBe(25);
    expect(subscriberDiscountPercent(3, 30, 365)).toBe(3);
  });

  it("parses only whole in-range numbers", () => {
    expect(parseLoyaltyNumber("5", 2, 50)).toBe(5);
    expect(parseLoyaltyNumber(" 5 ", 2, 50)).toBe(5);
    expect(parseLoyaltyNumber("", 2, 50)).toBeNull();
    expect(parseLoyaltyNumber("1", 2, 50)).toBeNull();
    expect(parseLoyaltyNumber("51", 2, 50)).toBeNull();
    expect(parseLoyaltyNumber("2.5", 2, 50)).toBeNull();
    expect(parseLoyaltyNumber("1e1", 2, 50)).toBeNull();
  });

  it("dedupes by duration, names the first plan, caps at three", () => {
    const lines = subscriberReadoutLines(3, 30, [
      { name: "A", durationDays: 30 },
      { name: "B", durationDays: 30 },
      { name: "C", durationDays: 90 },
      { name: "D", durationDays: 180 },
      { name: "E", durationDays: 365 },
    ]);
    expect(lines.map((l) => [l.planName, l.durationDays])).toEqual([
      ["A", 30],
      ["C", 90],
      ["D", 180],
    ]);
    expect(subscriberReadoutLines(3, 30, [])).toEqual([]);
  });
});
