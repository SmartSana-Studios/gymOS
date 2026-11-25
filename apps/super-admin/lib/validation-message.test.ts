import { describe, expect, it } from "vitest";

import { validationMessage } from "./validation-message";

const t = (key: string) => key;

describe("validationMessage", () => {
  it("translates a too-short reason", () => {
    expect(validationMessage({ path: ["reason"], code: "too_small", message: "Add a reason describing this credit" }, t)).toBe("validation.reasonRequired");
  });

  it("keeps the schema's message for any other issue", () => {
    expect(validationMessage({ path: ["days"], code: "too_big", message: "Enter a positive number of days" }, t)).toBe("Enter a positive number of days");
    expect(validationMessage({ path: ["reason"], code: "too_big", message: "Reason is too long" }, t)).toBe("Reason is too long");
  });

  it("falls back to the shared invalid-input text when there is no issue", () => {
    expect(validationMessage(undefined, t)).toBe("common.invalidInput");
  });
});
