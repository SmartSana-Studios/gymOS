"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Story 14.1 (AC #1, #3): mirrors apps/dashboard/app/global-error.tsx's own
// rationale -- cannot nest inside app/layout.tsx's I18nClientProvider, so a
// minimal hardcoded-English fallback is the pragmatic default. Capture-only
// scope (AC #5).
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
