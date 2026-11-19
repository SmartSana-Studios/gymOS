/**
 * Story 27.3: a staff check-in and a void by a live support session need a fresh authenticator code, verified server side and turned into a
 * single-use grant bound to (action, subject) before the call. Staff roles skip the grant. The service receives only the parsed input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const staffCheckIn = vi.fn();
const voidStaffCheckIn = vi.fn();
const isLiveSupportSession = vi.fn();
const issueSupportStepUp = vi.fn();

vi.mock("@/services/attendance", () => ({
  checkOutMember: vi.fn(),
  searchMembersForCheckIn: vi.fn(),
  staffCheckIn: (...a: unknown[]) => staffCheckIn(...a),
  voidStaffCheckIn: (...a: unknown[]) => voidStaffCheckIn(...a),
}));
vi.mock("@/services/support-stepup", async (importActual) => ({
  ...(await importActual<typeof import("@/services/support-stepup")>()),
  isLiveSupportSession: () => isLiveSupportSession(),
  issueSupportStepUp: (...a: unknown[]) => issueSupportStepUp(...a),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ATTENDANCE_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

beforeEach(() => {
  vi.clearAllMocks();
  isLiveSupportSession.mockResolvedValue(true);
  issueSupportStepUp.mockResolvedValue("issued");
  staffCheckIn.mockResolvedValue({ data: { outcome: "checked_in" }, error: null });
  voidStaffCheckIn.mockResolvedValue({ data: { outcome: "voided" }, error: null });
});

describe("staffCheckInAction (support)", () => {
  it("issues a support_staff_check_in grant bound to the member, then checks in with only the parsed input", async () => {
    const { staffCheckInAction } = await import("./actions");

    const result = await staffCheckInAction({ memberId: MEMBER_ID, authCode: "123456" });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_staff_check_in", subjectId: MEMBER_ID, code: "123456" });
    expect(staffCheckIn).toHaveBeenCalledTimes(1);
    expect(staffCheckIn).toHaveBeenCalledWith(MEMBER_ID);
    expect(issueSupportStepUp.mock.invocationCallOrder[0]).toBeLessThan(staffCheckIn.mock.invocationCallOrder[0]);
    expect(JSON.stringify(staffCheckIn.mock.calls[0])).not.toContain("123456");
  });

  it.each([undefined, "", "abc123", "12345"])("a missing or malformed code (%s) is code_required, with no grant and no call", async (authCode) => {
    const { staffCheckInAction } = await import("./actions");

    const result = await staffCheckInAction({ memberId: MEMBER_ID, authCode });

    expect(result.error?.code).toBe("code_required");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(staffCheckIn).not.toHaveBeenCalled();
  });

  it("a failed step-up checks nothing in", async () => {
    issueSupportStepUp.mockResolvedValue("invalid_code");
    const { staffCheckInAction } = await import("./actions");

    const result = await staffCheckInAction({ memberId: MEMBER_ID, authCode: "123456" });

    expect(result.error?.code).toBe("invalid_code");
    expect(staffCheckIn).not.toHaveBeenCalled();
  });

  it("a non-support session skips the grant", async () => {
    isLiveSupportSession.mockResolvedValue(false);
    const { staffCheckInAction } = await import("./actions");

    const result = await staffCheckInAction({ memberId: MEMBER_ID });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(staffCheckIn).toHaveBeenCalledWith(MEMBER_ID);
  });

  it("an invalid member id is a validation error and reaches nothing", async () => {
    const { staffCheckInAction } = await import("./actions");

    const result = await staffCheckInAction({ memberId: "nope" });

    expect(result.error?.code).toBe("validation_error");
    expect(staffCheckIn).not.toHaveBeenCalled();
  });
});

describe("voidStaffCheckInAction (support)", () => {
  it("issues a support_void_staff_check_in grant bound to the attendance row, then voids with the trimmed reason only", async () => {
    const { voidStaffCheckInAction } = await import("./actions");

    const result = await voidStaffCheckInAction({ attendanceId: ATTENDANCE_ID, reason: "  wrong member selected  ", authCode: "123456" });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_void_staff_check_in", subjectId: ATTENDANCE_ID, code: "123456" });
    expect(voidStaffCheckIn).toHaveBeenCalledWith(ATTENDANCE_ID, "wrong member selected");
    expect(issueSupportStepUp.mock.invocationCallOrder[0]).toBeLessThan(voidStaffCheckIn.mock.invocationCallOrder[0]);
    expect(JSON.stringify(voidStaffCheckIn.mock.calls[0])).not.toContain("123456");
  });

  it.each([undefined, "", "abc123", "12345"])("a missing or malformed code (%s) is code_required, with no grant and no call", async (authCode) => {
    const { voidStaffCheckInAction } = await import("./actions");

    const result = await voidStaffCheckInAction({ attendanceId: ATTENDANCE_ID, reason: "wrong member selected", authCode });

    expect(result.error?.code).toBe("code_required");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(voidStaffCheckIn).not.toHaveBeenCalled();
  });

  it("a non-support session skips the grant", async () => {
    isLiveSupportSession.mockResolvedValue(false);
    const { voidStaffCheckInAction } = await import("./actions");

    const result = await voidStaffCheckInAction({ attendanceId: ATTENDANCE_ID, reason: "wrong member selected" });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(voidStaffCheckIn).toHaveBeenCalledWith(ATTENDANCE_ID, "wrong member selected");
  });

  it("a short reason is the coded invalid_reason outcome, before any grant or call", async () => {
    const { voidStaffCheckInAction } = await import("./actions");

    const result = await voidStaffCheckInAction({ attendanceId: ATTENDANCE_ID, reason: "abcd", authCode: "123456" });

    expect(result.error).toBeNull();
    expect(result.data?.outcome).toBe("invalid_reason");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(voidStaffCheckIn).not.toHaveBeenCalled();
  });
});
