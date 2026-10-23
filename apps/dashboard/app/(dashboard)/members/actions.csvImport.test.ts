/**
 * Story 26.2: the csv actions pass the fee-0 acknowledgement through as a literal
 * `true` only, and re-validate from the raw text on confirm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmRows = vi.fn();
const validateRows = vi.fn();
const mapRows = vi.fn();

vi.mock("@/services/members", () => ({}));
vi.mock("@/services/gym-settings", () => ({ getGymSettings: vi.fn() }));
vi.mock("@/services/coaches", () => ({ assignCoach: vi.fn(), getCoachAssignments: vi.fn() }));
vi.mock("@/services/csvImport", () => ({
  confirmCsvImport: (...a: unknown[]) => confirmRows(...a),
  mapCsvRows: (...a: unknown[]) => mapRows(...a),
  validateCsvImport: (...a: unknown[]) => validateRows(...a),
}));
vi.mock("@/services/session", () => ({ getDashboardShellContext: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));
vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({ sendEvolutionApiMessage: vi.fn() }));

import { confirmCsvImport, validateCsvImport } from "./actions";

const TEXT = "member_name,phone\nAda Test,+237670000001\n";
const ROWS = [{ row: 2, planId: null }];

describe("csv import actions (Story 26.2)", () => {
  beforeEach(() => {
    [confirmRows, validateRows, mapRows].forEach((m) => m.mockReset());
    mapRows.mockResolvedValue({ data: { rows: [], skippedBlankRows: [] }, error: null });
    validateRows.mockResolvedValue({ valid: true, rows: ROWS, feeFreeWithoutPlan: true });
    confirmRows.mockResolvedValue({ data: { count: 1, awaiting: 0 }, error: null });
  });

  it("validate carries the fee-0 flag", async () => {
    const r = await validateCsvImport(TEXT);
    expect(r).toMatchObject({ valid: true, feeFreeWithoutPlan: true });
  });

  it("confirm passes a literal true through and re-validates from the raw text", async () => {
    await confirmCsvImport(TEXT, true);
    expect(validateRows).toHaveBeenCalledTimes(1);
    expect(confirmRows).toHaveBeenCalledWith(ROWS, { acknowledgeNoFee: true });
  });

  it("only the literal true counts", async () => {
    for (const v of [undefined, false, "true", 1] as unknown[]) {
      confirmRows.mockClear();
      await confirmCsvImport(TEXT, v as boolean);
      expect(confirmRows).toHaveBeenCalledWith(ROWS, { acknowledgeNoFee: false });
    }
  });

  it("a failed re-validation never reaches the service confirm", async () => {
    validateRows.mockResolvedValue({ valid: false, errors: [] });
    const r = await confirmCsvImport(TEXT, true);
    expect(r.error?.code).toBe("csv_import_failed");
    expect(confirmRows).not.toHaveBeenCalled();
  });
});
