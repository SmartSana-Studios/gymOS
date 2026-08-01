"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import { CSV_TEMPLATE_COLUMNS } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { parseCsvRows } from "@/lib/csv";
import type { CsvRowError, ValidatedCsvRow } from "@/services/csvImport";
import { confirmCsvImport, validateCsvImport } from "../actions";

// Scope Note #3: ">100 records" is scoped down to an indeterminate spinner
// with a different copy, not real "X of Y" polling -- there's no
// background-job infrastructure in this architecture to report a live
// count from.
const LARGE_IMPORT_ROW_THRESHOLD = 100;
const PREVIEW_ROW_COUNT = 5;

type Step = "upload" | "result" | "confirming";

type ValidationResult =
  | { valid: true; rows: ValidatedCsvRow[]; skippedBlankRows: number[] }
  | { valid: false; errors: CsvRowError[] };

const STATUS_LABEL_KEY: Record<string, string> = {
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Matches MembersPageClient's own handleExport Blob-download pattern.
// Firefox (and older browsers) can silently no-op a `.click()` on an <a>
// that was never attached to the DOM -- append/remove around the click.
function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE_COLUMNS.join(",")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "members_import_template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** AD-07's CSV Import 2-step wizard: Upload → Validation Result →
 * Confirming. Native <dialog>, matches MemberModal/DeactivateMemberDialog's
 * established convention, max-width 720px per AD-07. Manager+ only --
 * gated by MembersPageClient's own `canManage` check before this modal is
 * ever rendered; RLS is the real enforcement boundary either way. */
export function CsvImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (count: number, warning?: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isLargeImport, setIsLargeImport] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function resetAndClose() {
    if (validating || confirming) return;
    onClose();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0] ?? null;
    // The file input's accept=".csv" only filters the native picker --
    // drag-and-drop bypasses it entirely, so check the extension here too.
    if (dropped && dropped.name.toLowerCase().endsWith(".csv")) setFile(dropped);
  }

  async function handleValidate() {
    if (!file) return;
    setValidating(true);
    setConfirmError(null);
    try {
      const text = await readFileAsText(file);
      setRawText(text);
      // Read once client-side (not a second server round-trip) purely to
      // decide which "Importing…" copy to show at confirm time -- data-row
      // count only, not a validity check (validateCsvImport is the real one).
      const dataRowCount = Math.max(0, parseCsvRows(text).length - 1);
      setIsLargeImport(dataRowCount > LARGE_IMPORT_ROW_THRESHOLD);
      const result = await validateCsvImport(text);
      setValidation(result);
      setStep("result");
    } catch {
      setValidation({
        valid: false,
        errors: [{ row: 0, column: "file", message: t("common.somethingWentWrong") }],
      });
      setStep("result");
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirm() {
    setStep("confirming");
    setConfirming(true);
    setConfirmError(null);
    try {
      const { data, error } = await confirmCsvImport(rawText);
      // Matches MemberModal's own createMember handling: "audit_log_failed"
      // means every member was provisioned correctly, just the audit-log
      // write itself failed -- treat it as success with a warning, not a
      // blocked import.
      if (error && error.code !== "audit_log_failed") {
        setConfirmError(error.message);
        setStep("result");
        return;
      }
      if (data) {
        onImported(data.count, error?.code === "audit_log_failed" ? error.message : undefined);
      }
    } catch {
      setConfirmError(t("common.somethingWentWrong"));
      setStep("result");
    } finally {
      setConfirming(false);
    }
  }

  function handleReupload() {
    setFile(null);
    setRawText("");
    setValidation(null);
    setConfirmError(null);
    setStep("upload");
  }

  const previewRows = validation?.valid ? validation.rows.slice(0, PREVIEW_ROW_COUNT) : [];
  // A template-level failure (missing column, empty file, or an
  // unexpected infra error) has no row of its own -- the Server Action
  // wrapper surfaces it as a single synthetic `row: 0` entry, rendered here
  // as a plain banner instead of a per-row table.
  const isTemplateLevelError =
    validation && !validation.valid && validation.errors.length === 1 && validation.errors[0].row === 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (validating || confirming) e.preventDefault();
      }}
      className="w-full max-w-[720px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("members.csvImport.title")}</h2>
          <button
            type="button"
            aria-label={t("members.modal.close")}
            onClick={resetAndClose}
            disabled={validating || confirming}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {step === "upload" && (
          <>
            <button type="button" onClick={downloadTemplate} className="text-sm text-primary underline">
              {t("members.csvImport.downloadTemplate")}
            </button>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
            >
              <p>
                {t("members.csvImport.uploadZoneText")}{" "}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-primary underline"
                >
                  {t("members.csvImport.browseButton")}
                </button>
              </p>
              <p>{t("members.csvImport.acceptedFiles")}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {file && (
              <div className="flex items-center justify-between text-sm">
                <span>{t("members.csvImport.selectedFile", { filename: file.name })}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    // Without this, re-selecting the exact same file after
                    // Remove fires no `change` event (the native input's
                    // `value` still holds that filename), so `file` would
                    // silently stay null with no error shown.
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-muted-foreground underline"
                >
                  {t("members.csvImport.remove")}
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={resetAndClose}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={handleValidate} disabled={!file || validating}>
                {validating ? (
                  t("members.csvImport.validating")
                ) : (
                  <>
                    {t("members.csvImport.validateButton")}
                    <ArrowRight />
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {step === "result" && validation && (
          <>
            {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}

            {validation.valid ? (
              <>
                <p className="text-sm text-green-700">
                  {t("members.csvImport.successSummary", { count: validation.rows.length })}
                </p>
                {validation.skippedBlankRows.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("members.csvImport.blankRowsSkipped", {
                      count: validation.skippedBlankRows.length,
                      rows: validation.skippedBlankRows.join(", "),
                    })}
                  </p>
                )}
                <div>
                  <p className="text-sm font-medium">{t("members.csvImport.previewHeading")}</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50 text-left">
                        <tr>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.name")}</th>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.phone")}</th>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.plan")}</th>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.status")}</th>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.joinDate")}</th>
                          <th className="p-2 font-medium">{t("members.csvImport.previewColumns.expiry")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={row.row} className="border-b last:border-0">
                            <td className="p-2">{row.name}</td>
                            <td className="p-2">{row.phone}</td>
                            <td className="p-2">{row.planName}</td>
                            <td className="p-2">
                              {STATUS_LABEL_KEY[row.subscriptionStatus]
                                ? t(STATUS_LABEL_KEY[row.subscriptionStatus])
                                : row.subscriptionStatus}
                            </td>
                            <td className="p-2">{row.joinDate}</td>
                            <td className="p-2">{row.expiryDate ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={resetAndClose}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="button" onClick={handleConfirm}>
                    {t("members.csvImport.confirmImportButton")}
                    <ArrowRight />
                  </Button>
                </div>
              </>
            ) : isTemplateLevelError ? (
              <>
                <p className="text-sm text-red-600">
                  {t("members.csvImport.templateError", { message: validation.errors[0].message })}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={resetAndClose}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="button" onClick={handleReupload}>
                    {t("members.csvImport.reuploadButton")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-red-600">
                  {t("members.csvImport.errorSummary", { count: validation.errors.length })}
                </p>
                <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50 text-left">
                      <tr>
                        <th className="p-2 font-medium">{t("members.csvImport.table.row")}</th>
                        <th className="p-2 font-medium">{t("members.csvImport.table.column")}</th>
                        <th className="p-2 font-medium">{t("members.csvImport.table.error")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.errors.map((err, i) => (
                        <tr key={`${err.row}-${err.column}-${i}`} className="border-b last:border-0">
                          <td className="p-2">{err.row}</td>
                          <td className="p-2">{err.column}</td>
                          <td className="p-2">{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={resetAndClose}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="button" onClick={handleReupload}>
                    {t("members.csvImport.reuploadButton")}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {step === "confirming" && (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <p>{isLargeImport ? t("members.csvImport.importingLarge") : t("members.csvImport.importing")}</p>
          </div>
        )}
      </div>
    </dialog>
  );
}
