/**
 * Story 26.1: `editMember` validates with editMemberSchema and hands the three profile fields to `updateMember`.
 * The modal test mocks `editMember`, so this runs the real action and asserts what `updateMember` receives:
 * the right value reaches the right field, values are trimmed, and a cleared value is null.
 *
 * Collaborators are mocked at the service boundary, the same set as actions.createMember.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMember = vi.fn();
const logMemberChange = vi.fn();

vi.mock("@/services/members", () => ({
  getMemberForInvite: vi.fn(),
  getMemberSubscriptionState: vi.fn(),
  insertSubscription: vi.fn(),
  deactivateMember: vi.fn(),
  exportMembersCsv: vi.fn(),
  updateMember: (...args: unknown[]) => updateMember(...args),
  getPlanTypeForGym: vi.fn(),
  logMemberChange: (...args: unknown[]) => logMemberChange(...args),
  memberCountForGym: vi.fn(),
  provisionMemberRow: vi.fn(),
}));
vi.mock("@/services/gym-settings", () => ({ getGymSettings: vi.fn() }));
vi.mock("@/services/coaches", () => ({ assignCoach: vi.fn(), getCoachAssignments: vi.fn() }));
vi.mock("@/services/csvImport", () => ({ confirmCsvImport: vi.fn(), mapCsvRows: vi.fn(), validateCsvImport: vi.fn() }));
vi.mock("@/services/session", () => ({ getDashboardShellContext: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));
vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({ sendEvolutionApiMessage: vi.fn() }));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const base = { name: "Alice Mballa", email: null, dob: null, photoUrl: null, emergencyContact: null };

describe("editMember profile fields (Story 26.1)", () => {
  beforeEach(() => {
    updateMember.mockReset();
    logMemberChange.mockReset();
    updateMember.mockResolvedValue({ error: null });
    logMemberChange.mockResolvedValue({ error: null });
  });

  it("passes each value to its own field, trimmed", async () => {
    const { editMember } = await import("./actions");

    const result = await editMember(MEMBER_ID, { ...base, birthYear: 1984, profession: "  Soudeur ", neighborhood: " Ngui " });

    expect(result.error).toBeNull();
    expect(updateMember).toHaveBeenCalledWith(
      MEMBER_ID,
      expect.objectContaining({ birthYear: 1984, profession: "Soudeur", neighborhood: "Ngui" }),
    );
  });

  it("passes null for a cleared value and keeps the others", async () => {
    const { editMember } = await import("./actions");

    await editMember(MEMBER_ID, { ...base, birthYear: 1984, profession: "", neighborhood: "Ngui" });

    expect(updateMember).toHaveBeenCalledWith(
      MEMBER_ID,
      expect.objectContaining({ birthYear: 1984, profession: null, neighborhood: "Ngui" }),
    );
  });

  it.each([1850, 9999, 1984.5])("refuses birth year %s and writes nothing", async (birthYear) => {
    const { editMember } = await import("./actions");

    const result = await editMember(MEMBER_ID, { ...base, birthYear, profession: null, neighborhood: null });

    expect(result.error?.code).toBe("validation_error");
    expect(updateMember).not.toHaveBeenCalled();
  });
});
