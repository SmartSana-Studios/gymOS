/** Story 23-6c: the staff-creation action hands the support code to the service and nothing else. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createStaffMember = vi.fn();
vi.mock("@/services/staff", () => ({ createStaffMember: (...a: unknown[]) => createStaffMember(...a) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

beforeEach(() => {
  createStaffMember.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("createStaffMemberAction (Story 23-6c)", () => {
  it("passes the code as an option and keeps it out of the parsed input", async () => {
    const { createStaffMemberAction } = await import("./actions");

    await createStaffMemberAction({ name: "Jane Coach", phone: "+237680811041", role: "coach", authCode: "123456" });

    expect(createStaffMember).toHaveBeenCalledWith({ name: "Jane Coach", phone: "+237680811041", role: "coach" }, { authCode: "123456" });
  });

  it("passes no code when none was supplied", async () => {
    const { createStaffMemberAction } = await import("./actions");

    await createStaffMemberAction({ name: "Jane Coach", phone: "+237680811041", role: "coach" });

    expect(createStaffMember).toHaveBeenCalledWith(expect.anything(), { authCode: undefined });
  });
});
