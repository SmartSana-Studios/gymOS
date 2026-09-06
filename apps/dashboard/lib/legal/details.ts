import type { Locale } from "@/lib/i18n/config";

/**
 * Operator-supplied legal details for the hosted policy pages.
 *
 * These are the only values in the privacy policy that cannot be derived
 * from the codebase -- they are business/legal facts (who the legal entity
 * is, where it is, how a member reaches support, how long records are kept).
 * They are isolated here, rather than inlined into `privacy-policy.ts`, so
 * that changing them is a single-file edit that needs no review of the
 * policy prose itself.
 *
 * `null` means "not yet supplied". Any null here makes
 * `missingLegalDetails()` non-empty, which makes `/privacy` render an
 * explicit unpublished-draft banner instead of silently serving a policy
 * with "[SUPPORT EMAIL]" in it.
 */
export interface LegalDetails {
  /** Registered legal entity that operates GymOS. */
  legalEntity: string | null;
  /** Registered postal address of that entity. */
  address: string | null;
  /** Monitored inbox a member can write to. Play requires this to be a real,
   *  working route for data-deletion requests -- see docs/play-store-data-safety.md. */
  supportEmail: string | null;
  /**
   * Retention period, per locale, phrased to complete the sentence "We keep
   * your information ___." in §5 of the policy.
   *
   * Per-locale rather than a single shared string because this is the one
   * detail on this list that is *prose*, not a language-neutral fact: an
   * entity name, an address and an email read identically in English and
   * French, but "for one year after it ends" does not. A single shared
   * string would have put an untranslated English clause in the middle of
   * the French policy -- and a retention statement is precisely the kind of
   * sentence counsel needs to be able to review in the language it is
   * actually served in.
   */
  retentionPeriod: Record<Locale, string> | null;
  /** Minimum membership age GymOS is directed at. */
  minimumAge: number | null;
}

export const LEGAL_DETAILS: LegalDetails = {
  legalEntity: "GetSocial Inc",
  address: "Yaoundé, Melen",
  supportEmail: "info@smartsana.com",
  retentionPeriod: {
    en: "for as long as your membership is active, and for one year after it ends",
    fr: "tant que votre adhésion est active, puis pendant un an après sa fin",
  },
  minimumAge: 18,
};

/**
 * Date the policy text itself last changed. Bumped by hand when
 * `privacy-policy.ts`'s prose changes -- deliberately not a build timestamp,
 * which would churn the visible "last updated" date on every redeploy and
 * make it meaningless as a change signal to a member or a store reviewer.
 */
export const POLICY_LAST_UPDATED = "2026-09-06";

/** Field names still unsupplied, in declaration order. Empty === publishable. */
export function missingLegalDetails(details: LegalDetails = LEGAL_DETAILS): (keyof LegalDetails)[] {
  return (Object.keys(details) as (keyof LegalDetails)[]).filter(
    (key) => details[key] === null,
  );
}

/** Resolves a detail to the plain string the policy interpolates for `locale`.
 *  Only `retentionPeriod` is locale-dependent; everything else is a
 *  language-neutral fact rendered identically in both policies. */
export function resolveDetail(
  details: LegalDetails,
  field: keyof LegalDetails,
  locale: Locale,
): string | null {
  const value = details[field];
  if (value === null) return null;
  if (typeof value === "object") return value[locale];
  return String(value);
}
