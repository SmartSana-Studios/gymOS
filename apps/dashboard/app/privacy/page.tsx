import { Suspense } from "react";
import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import type { Locale } from "@/lib/i18n/config";
import {
  LEGAL_DETAILS,
  POLICY_LAST_UPDATED,
  missingLegalDetails,
  resolveDetail,
  type LegalDetails,
} from "@/lib/legal/details";
import {
  PRIVACY_POLICY,
  SECTION_ORDER,
  type PolicySection,
} from "@/lib/legal/privacy-policy";

// Public route: deliberately a sibling of `(dashboard)`, not a child, so it
// carries none of that group's auth gating. App Store Connect and Play
// Console both fetch this URL unauthenticated, and re-fetch it periodically
// after the listing goes live -- it has to render for a signed-out visitor.
export const metadata: Metadata = {
  title: "Privacy Policy · GymOS",
  description:
    "How GymOS collects, uses, shares and retains information about gym members and staff.",
  // Store reviewers reach this by URL, but an indexable policy page is also
  // what lets a member find it without going through the app.
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <Suspense fallback={<PolicyFallback />}>
      <PolicyDocument />
    </Suspense>
  );
}

/** Rendered while the locale resolves. Deliberately text-free: showing an
 *  English skeleton to a French reader for a frame is worse than showing
 *  nothing, and this resolves in a single request with no network I/O of its
 *  own beyond the memoized locale lookup. */
function PolicyFallback() {
  return <div className="min-h-screen bg-background" aria-hidden="true" />;
}

async function PolicyDocument() {
  const locale = await getRequestLocale();
  const doc = PRIVACY_POLICY[locale];
  const missing = missingLegalDetails();
  const fill = (text: string) => interpolate(text, LEGAL_DETAILS, locale);

  const lastUpdated = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${POLICY_LAST_UPDATED}T00:00:00Z`));

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {doc.lastUpdatedLabel}
        {": "}
        <time dateTime={POLICY_LAST_UPDATED}>{lastUpdated}</time>
      </p>

      {missing.length > 0 ? (
        <aside
          role="note"
          className="mt-8 rounded-md border border-destructive/50 bg-destructive/10 p-4"
        >
          <p className="font-medium text-destructive">{doc.draft.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{doc.draft.body}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {missing.map((field) => (
              <li key={field}>{doc.draft.fieldLabels[field] ?? field}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      <p className="mt-8 leading-relaxed">{doc.intro}</p>

      {SECTION_ORDER.map((id) => (
        <Section key={id} section={doc.sections[id]} fill={fill} />
      ))}
    </main>
  );
}

function Section({
  section,
  fill,
}: {
  section: PolicySection;
  fill: (text: string) => string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>

      {section.table ? (
        // Wide content scrolls inside its own container rather than forcing
        // the page body to scroll horizontally on a phone.
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                {section.table.headers.map((header) => (
                  <th key={header} className="py-2 pr-4 font-medium align-top">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row[0]} className="border-b last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="py-3 pr-4 align-top text-muted-foreground first:text-foreground first:font-medium"
                    >
                      {fill(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {section.bullets ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{fill(bullet)}</li>
          ))}
        </ul>
      ) : null}

      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-4 leading-relaxed">
          {fill(paragraph)}
        </p>
      ))}
    </section>
  );
}

/**
 * Fills `{{field}}` tokens from LEGAL_DETAILS. An unsupplied (null) field
 * renders as a visible `[FIELD]` marker rather than an empty string or the
 * raw token -- a policy missing its support email should read as obviously
 * unfinished to anyone who loads the page, which is the same signal the
 * draft banner above gives. Unknown tokens are left untouched so a typo in
 * the content module surfaces instead of silently vanishing.
 */
function interpolate(text: string, details: LegalDetails, locale: Locale): string {
  return text.replace(/\{\{(\w+)\}\}/g, (token, field: string) => {
    if (!(field in details)) return token;
    const value = resolveDetail(details, field as keyof LegalDetails, locale);
    if (value === null) return `[${toScreamingCase(field)}]`;
    return value;
  });
}

function toScreamingCase(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}
