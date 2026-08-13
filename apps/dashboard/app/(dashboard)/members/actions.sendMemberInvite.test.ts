/**
 * Story 2.10 (Task 2, AC #1-#4): unit tests for the `sendMemberInvite`
 * Server Action's orchestration logic. Mocks the collaborators
 * (`getMemberForInvite`, `getDashboardShellContext`, `sendEvolutionApiMessage`,
 * locale/translation) so this suite exercises exactly what this story adds --
 * validation, member re-fetch, message composition, and the `sent`/`error`
 * branching AC #2/#3 depend on -- without a real DB or network call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemberForInvite = vi.fn();
const getDashboardShellContext = vi.fn();
const sendEvolutionApiMessage = vi.fn();

vi.mock("@/services/members", () => ({
  getMemberForInvite: (...args: unknown[]) => getMemberForInvite(...args),
  // Other named exports actions.ts imports from this module -- unused by
  // sendMemberInvite, stubbed only so the module doesn't fail to resolve.
  deactivateMember: vi.fn(),
  exportMembersCsv: vi.fn(),
  getPlanTypeForGym: vi.fn(),
  logMemberChange: vi.fn(),
  memberCountForGym: vi.fn(),
  provisionMemberRow: vi.fn(),
  updateMember: vi.fn(),
}));

vi.mock("@/services/coaches", () => ({
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(),
}));

vi.mock("@/services/csvImport", () => ({
  confirmCsvImport: vi.fn(),
  mapCsvRows: vi.fn(),
  validateCsvImport: vi.fn(),
}));

vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  })),
}));

vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({
  sendEvolutionApiMessage: (...args: unknown[]) => sendEvolutionApiMessage(...args),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("sendMemberInvite", () => {
  beforeEach(() => {
    getMemberForInvite.mockReset();
    getDashboardShellContext.mockReset();
    sendEvolutionApiMessage.mockReset();

    getMemberForInvite.mockResolvedValue({ data: { name: "Alice", phone: "+237680811041" }, error: null });
    getDashboardShellContext.mockResolvedValue({
      data: { gymId: "gym-1", gymName: "Iron Gym", memberName: "Owner", role: "owner", mustChangePassword: false },
      error: null,
    });
  });

  it("returns a validation error for a malformed memberId, without calling the messaging provider", async () => {
    const { sendMemberInvite } = await import("./actions");

    const result = await sendMemberInvite("not-a-uuid");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("validation_error");
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("propagates a not_found error when the member doesn't belong to the caller's gym", async () => {
    getMemberForInvite.mockResolvedValue({ data: null, error: { code: "not_found", message: "not found" } });
    const { sendMemberInvite } = await import("./actions");

    const result = await sendMemberInvite(MEMBER_ID);

    expect(result).toEqual({ data: null, error: { code: "not_found", message: "not found" } });
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("AC #1/#2: on a successful gateway send, returns sent:true with no error", async () => {
    sendEvolutionApiMessage.mockResolvedValue({ success: true, channel: "whatsapp" });
    const { sendMemberInvite } = await import("./actions");

    const result = await sendMemberInvite(MEMBER_ID);

    expect(result).toEqual({ data: { sent: true }, error: null });
  });

  it("AC #3: on a gateway failure, returns sent:false with error:null (the expected fallback outcome, not a generic AppError)", async () => {
    sendEvolutionApiMessage.mockResolvedValue({ success: false, error: "Evolution API 500: boom" });
    const { sendMemberInvite } = await import("./actions");

    const result = await sendMemberInvite(MEMBER_ID);

    expect(result).toEqual({ data: { sent: false }, error: null });
  });

  it("composes the message from the re-fetched member name and the session's gymName, never a client-supplied value", async () => {
    sendEvolutionApiMessage.mockResolvedValue({ success: true, channel: "whatsapp" });
    const { sendMemberInvite } = await import("./actions");

    await sendMemberInvite(MEMBER_ID);

    expect(sendEvolutionApiMessage).toHaveBeenCalledWith(
      "+237680811041",
      expect.stringContaining('"name":"Alice"'),
    );
    expect(sendEvolutionApiMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"gymName":"Iron Gym"'),
    );
  });

  it("AC #4: a second send for the same member is a fresh, independent attempt (no resend guard)", async () => {
    sendEvolutionApiMessage.mockResolvedValueOnce({ success: false, error: "unreachable" });
    sendEvolutionApiMessage.mockResolvedValueOnce({ success: true, channel: "whatsapp" });
    const { sendMemberInvite } = await import("./actions");

    const first = await sendMemberInvite(MEMBER_ID);
    const second = await sendMemberInvite(MEMBER_ID);

    expect(first.data).toEqual({ sent: false });
    expect(second.data).toEqual({ sent: true });
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(2);
  });
});
