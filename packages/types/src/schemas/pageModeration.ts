import { z } from "zod";

// Story 24.11 (FR-203, FR-204, FR-207): takedown, lift, visitor reports and appeals for gym landing pages. Mirrors migration 0167.
// ONE source for the reason codes and their words: the Super Admin screens, the dashboard banner, the Owner notice copy (the database
// holds the same pairs in private.page_takedown_label), the public report form and the page-template chrome all read this file.

/** The six reason codes, in the order a form offers them. A takedown and a visitor report use the same codes (FR-204). */
export const PAGE_TAKEDOWN_REASONS = ["impersonation", "illegal_content", "trademark", "misleading_content", "privacy", "other"] as const;
export type PageTakedownReason = (typeof PAGE_TAKEDOWN_REASONS)[number];
export const pageTakedownReasonSchema = z.enum(PAGE_TAKEDOWN_REASONS);

export type PageModerationLanguage = "en" | "fr";

/** Admin labels (EXPERIENCE.md AD-27 / SA-17): Super Admin dialogs, the Owner banner and the Owner notice. */
export const PAGE_TAKEDOWN_REASON_LABELS: Record<PageTakedownReason, Record<PageModerationLanguage, string>> = {
  impersonation: { en: "Impersonation", fr: "Usurpation d'identité" },
  illegal_content: { en: "Illegal content", fr: "Contenu illicite" },
  trademark: { en: "Trademark", fr: "Marque déposée" },
  misleading_content: { en: "Misleading content", fr: "Contenu trompeur" },
  privacy: { en: "Privacy", fr: "Vie privée" },
  other: { en: "Other", fr: "Autre" },
};

/** Visitor labels (EXPERIENCE.md PS-03): the radio group of the public report form. */
export const PAGE_REPORT_REASON_LABELS: Record<PageTakedownReason, Record<PageModerationLanguage, string>> = {
  impersonation: { en: "Pretending to be someone else", fr: "Se fait passer pour quelqu'un d'autre" },
  misleading_content: { en: "Misleading information", fr: "Informations trompeuses" },
  illegal_content: { en: "Illegal content", fr: "Contenu illicite" },
  trademark: { en: "Trademark or brand", fr: "Marque ou nom commercial" },
  privacy: { en: "Private information", fr: "Informations privées" },
  other: { en: "Something else", fr: "Autre chose" },
};

/** The order PS-03 lists the visitor reasons in (it differs from the admin order). */
export const PAGE_REPORT_REASON_ORDER: readonly PageTakedownReason[] = ["impersonation", "misleading_content", "illegal_content", "trademark", "privacy", "other"];

export const PAGE_TAKEDOWN_NOTE_MIN = 3;
export const PAGE_TAKEDOWN_NOTE_MAX = 500;
export const PAGE_MODERATION_REASON_MIN = 3;
export const PAGE_MODERATION_REASON_MAX = 500;
export const PAGE_APPEAL_REASON_MAX = 500;
export const PAGE_REPORT_DETAILS_MAX = 1000;
/** Business days a report may wait before it is Overdue [ASSUMPTION, EXPERIENCE.md SA-17]. */
export const PAGE_REPORT_DUE_BUSINESS_DAYS = 5;

/** Typed refusals (message suffix `<function>: <code>`). Copy: super-admin `pages.errors.<code>`, dashboard `pageAppeal.errors.<code>`. */
export const PAGE_TAKEDOWN_ERROR_CODES = ["invalid_reason", "note_required", "note_invalid", "no_page", "already_taken_down"] as const;
export const PAGE_LIFT_ERROR_CODES = ["reason_required", "not_taken_down"] as const;
export const PAGE_REPORT_CLOSE_ERROR_CODES = ["invalid_outcome", "note_required", "note_invalid", "not_found", "not_open", "not_taken_down"] as const;
export const PAGE_APPEAL_ERROR_CODES = ["reason_required", "not_taken_down", "appeal_open", "appeal_decided", "not_admitted"] as const;
export const PAGE_APPEAL_DECISION_ERROR_CODES = ["invalid_decision", "reason_required", "not_found", "not_open", "not_taken_down"] as const;
export type PageAppealErrorCode = (typeof PAGE_APPEAL_ERROR_CODES)[number];

/** What `public_site.submit_page_report` answers. */
export const PAGE_REPORT_RESULTS = ["ok", "rate_limited", "not_found", "invalid"] as const;
export type PageReportResult = (typeof PAGE_REPORT_RESULTS)[number];

export const takeDownGymPageSchema = z
  .strictObject({
    gymId: z.uuid(),
    reason: pageTakedownReasonSchema,
    note: z.string().trim().max(PAGE_TAKEDOWN_NOTE_MAX).optional(),
    /** The open report this takedown answers, if any; the page's open reports are closed as taken_down. */
    reportIds: z.array(z.uuid()).max(200).optional(),
  })
  .refine((v) => v.reason !== "other" || (v.note ?? "").length >= PAGE_TAKEDOWN_NOTE_MIN, { path: ["note"], message: "note_required" });
export type TakeDownGymPageInput = z.infer<typeof takeDownGymPageSchema>;

export const liftGymPageTakedownSchema = z.strictObject({
  gymId: z.uuid(),
  reason: z.string().trim().min(PAGE_MODERATION_REASON_MIN).max(PAGE_MODERATION_REASON_MAX),
});
export type LiftGymPageTakedownInput = z.infer<typeof liftGymPageTakedownSchema>;

export const dismissPageReportsSchema = z.strictObject({
  reportIds: z.array(z.uuid()).min(1).max(200),
  note: z.string().trim().min(PAGE_MODERATION_REASON_MIN).max(PAGE_MODERATION_REASON_MAX),
});
export type DismissPageReportsInput = z.infer<typeof dismissPageReportsSchema>;

export const decidePageAppealSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(["lift", "uphold"]),
  reason: z.string().trim().min(PAGE_MODERATION_REASON_MIN).max(PAGE_MODERATION_REASON_MAX),
});
export type DecidePageAppealInput = z.infer<typeof decidePageAppealSchema>;

export const submitPageAppealSchema = z.strictObject({ reason: z.string().trim().min(1).max(PAGE_APPEAL_REASON_MAX) });
export type SubmitPageAppealInput = z.infer<typeof submitPageAppealSchema>;

/** The public report form after parsing. Details are required (PS-03: 1 to 1000 characters). */
export const pageReportInputSchema = z.strictObject({
  reason: pageTakedownReasonSchema,
  details: z.string().trim().min(1).max(PAGE_REPORT_DETAILS_MAX),
});
export type PageReportInput = z.infer<typeof pageReportInputSchema>;

/** The appeal part of get_gym_page_status(): null when the page is not taken down. `lift` appears only transiently (a lifted takedown has no appeal block). */
export const PAGE_APPEAL_STATES = ["none", "open", "lift", "uphold"] as const;
export const pageAppealStatusSchema = z.strictObject({
  state: z.enum(PAGE_APPEAL_STATES),
  submitted_at: z.string().nullable(),
  decided_at: z.string().nullable(),
  /** Shown to the Owner (SA-18: the decision reason is sent to them). Never the internal takedown note. */
  decision_reason: z.string().nullable(),
});
export type PageAppealStatus = z.infer<typeof pageAppealStatusSchema>;

export function pageTakedownReasonLabel(code: string | null | undefined, language: PageModerationLanguage): string | null {
  return code && (PAGE_TAKEDOWN_REASONS as readonly string[]).includes(code) ? PAGE_TAKEDOWN_REASON_LABELS[code as PageTakedownReason][language] : null;
}
