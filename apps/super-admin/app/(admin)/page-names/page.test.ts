import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

import PageNamesPage from "./page";

describe("the old /page-names address", () => {
  it("keeps working: it sends the visitor to the Held names tab of Pages", () => {
    expect(() => PageNamesPage()).toThrow("REDIRECT:/pages?tab=names");
    expect(redirect).toHaveBeenCalledWith("/pages?tab=names");
  });
});
