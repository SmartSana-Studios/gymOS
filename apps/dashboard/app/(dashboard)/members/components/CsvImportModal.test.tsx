/**
 * Story 26.2: one template. The modal offers a single download, previews rows with blank plan cells, gates Confirm behind the
 * fee-0 acknowledgement when some row has no plan and passes that acknowledgement to the server, and reports the awaiting count.
 * Rendered with `t` mocked as the identity, so assertions are on keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const validateCsvImport = vi.fn();
const confirmCsvImport = vi.fn();

vi.mock("../actions", () => ({
  validateCsvImport: (...args: unknown[]) => validateCsvImport(...args),
  confirmCsvImport: (...args: unknown[]) => confirmCsvImport(...args),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const noPlan = (row: number, name: string, phone: string) => ({
  row, name, phone, planId: null, planName: null, joinDate: "2026-10-23", subscriptionStatus: null, expiryDate: null,
  birthYear: null, profession: null, neighborhood: null,
});
const withPlan = {
  row: 4, name: "Plan Person", phone: "+237671800409", planId: "p1", planName: "Monthly", joinDate: "2026-01-01",
  subscriptionStatus: "active", expiryDate: "2099-01-01", birthYear: null, profession: null, neighborhood: null,
};
const NO_PLAN_ROWS = [noPlan(2, "Test One", "+237671800401"), noPlan(3, "Test Two", "+237671800402")];

async function uploadAndValidate(user: ReturnType<typeof userEvent.setup>) {
  const { CsvImportModal } = await import("./CsvImportModal");
  const onImported = vi.fn();
  const { container } = render(<CsvImportModal onClose={vi.fn()} onImported={onImported} phoneCountry="CM" />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["member_name,phone\n"], "roster.csv", { type: "text/csv" }));
  await user.click(screen.getByRole("button", { name: "members.csvImport.validateButton" }));
  return { onImported };
}

describe("CsvImportModal (Story 26.2)", () => {
  beforeEach(() => {
    validateCsvImport.mockReset();
    confirmCsvImport.mockReset();
  });

  it("offers one template download", async () => {
    const { CsvImportModal } = await import("./CsvImportModal");
    render(<CsvImportModal onClose={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getAllByText("members.csvImport.downloadTemplate")).toHaveLength(1);
  });

  it("fee gym, rows without a plan: preview shows dashes, no warning, Confirm enabled, awaiting count reported", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: NO_PLAN_ROWS, skippedBlankRows: [], feeFreeWithoutPlan: false });
    confirmCsvImport.mockResolvedValue({ data: { count: 2, awaiting: 2 }, error: null });
    const user = userEvent.setup();
    const { onImported } = await uploadAndValidate(user);

    expect(await screen.findByText("Test One")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("members.csvImport.feeFreeWarning")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "members.csvImport.confirmImportButton" });
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 2, undefined));
    expect(confirmCsvImport).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it("fee-0 gym, rows without a plan: warning shown, Confirm gated until acknowledged, acknowledgement sent as true", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: NO_PLAN_ROWS, skippedBlankRows: [], feeFreeWithoutPlan: true });
    confirmCsvImport.mockResolvedValue({ data: { count: 2, awaiting: 0 }, error: null });
    const user = userEvent.setup();
    const { onImported } = await uploadAndValidate(user);

    expect(await screen.findByText("members.csvImport.feeFreeWarning")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "members.csvImport.confirmImportButton" });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByLabelText("members.csvImport.feeFreeAcknowledge"));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 0, undefined));
    expect(confirmCsvImport).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("a server refusal stays on the result step with the warning still shown", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: NO_PLAN_ROWS, skippedBlankRows: [], feeFreeWithoutPlan: true });
    confirmCsvImport.mockResolvedValue({ data: null, error: { code: "csv_fee_ack_required", message: "refused" } });
    const user = userEvent.setup();
    await uploadAndValidate(user);
    await user.click(await screen.findByLabelText("members.csvImport.feeFreeAcknowledge"));
    await user.click(screen.getByRole("button", { name: "members.csvImport.confirmImportButton" }));

    expect(await screen.findByText("refused")).toBeInTheDocument();
    expect(screen.getByText("members.csvImport.feeFreeWarning")).toBeInTheDocument();
  });

  it("the fee became 0 after validation: the refusal brings up the warning and the retry sends true", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: NO_PLAN_ROWS, skippedBlankRows: [], feeFreeWithoutPlan: false });
    confirmCsvImport
      .mockResolvedValueOnce({ data: null, error: { code: "csv_fee_ack_required", message: "refused" } })
      .mockResolvedValueOnce({ data: { count: 2, awaiting: 0 }, error: null });
    const user = userEvent.setup();
    const { onImported } = await uploadAndValidate(user);

    expect(screen.queryByText("members.csvImport.feeFreeWarning")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "members.csvImport.confirmImportButton" }));

    expect(await screen.findByText("members.csvImport.feeFreeWarning")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "members.csvImport.confirmImportButton" });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText("members.csvImport.feeFreeAcknowledge"));
    await user.click(confirm);

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 0, undefined));
    expect(confirmCsvImport).toHaveBeenLastCalledWith(expect.any(String), true);
  });

  it("says how many rows have no plan, and says nothing when every row has one", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: [withPlan, ...NO_PLAN_ROWS], skippedBlankRows: [], feeFreeWithoutPlan: false });
    const user = userEvent.setup();
    await uploadAndValidate(user);
    expect(await screen.findByText("members.csvImport.noPlanSummary")).toBeInTheDocument();
  });

  it("no rows without a plan: no no-plan line", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: [withPlan], skippedBlankRows: [], feeFreeWithoutPlan: false });
    const user = userEvent.setup();
    await uploadAndValidate(user);
    expect(await screen.findByText("Plan Person")).toBeInTheDocument();
    expect(screen.queryByText("members.csvImport.noPlanSummary")).not.toBeInTheDocument();
  });

  it("a file where every row has a plan: no warning even at fee 0, and no acknowledgement sent", async () => {
    validateCsvImport.mockResolvedValue({ valid: true, rows: [withPlan], skippedBlankRows: [], feeFreeWithoutPlan: false });
    confirmCsvImport.mockResolvedValue({ data: { count: 1, awaiting: 0 }, error: null });
    const user = userEvent.setup();
    const { onImported } = await uploadAndValidate(user);

    expect(await screen.findByText("Plan Person")).toBeInTheDocument();
    expect(screen.queryByText("members.csvImport.feeFreeWarning")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "members.csvImport.confirmImportButton" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(1, 0, undefined));
    expect(confirmCsvImport).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it("a template-level error shows the banner and a way to upload again", async () => {
    validateCsvImport.mockResolvedValue({ valid: false, errors: [{ row: 0, column: "file", message: "missing phone" }] });
    const user = userEvent.setup();
    await uploadAndValidate(user);

    expect(await screen.findByText("members.csvImport.templateError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "members.csvImport.reuploadButton" })).toBeInTheDocument();
  });
});
