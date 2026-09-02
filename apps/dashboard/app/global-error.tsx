"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Story 14.1 (AC #1, #3): global-error.tsx is a genuine Next.js special
// case -- it replaces the root layout entirely when active, so it cannot
// nest inside app/layout.tsx's I18nClientProvider (the very layout that may
// be what crashed). A minimal hardcoded-English fallback is the pragmatic
// default here (matches Next.js's and Sentry's own official examples) --
// this codebase's i18n-parity discipline (scripts/check-i18n-key-parity.mjs)
// only diffs locale files against each other, so it does not enforce
// translation coverage on this file's plain text. Capture-only scope (AC
// #5): no retry telemetry, no user feedback dialog.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { digest: error.digest } });
  }, [error]);

  /* eslint-disable i18next/no-literal-string -- global-error.tsx cannot
     nest inside app/layout.tsx's I18nClientProvider (see the file-level
     comment above), so this hardcoded-English fallback is a deliberate,
     disclosed exception to this repo's i18n-parity discipline. */
  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
        <p>An unexpected error occurred. Please try refreshing the page.</p>
      </body>
    </html>
  );
  /* eslint-enable i18next/no-literal-string */
}
