"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes renders an inline <script> (the no-flash theme bootstrap). React 19
// logs "Encountered a script tag while rendering React component" in development
// whenever the provider renders on the client, even though the script is only
// meaningful in the server HTML and is harmless here. Known upstream issue
// (pacocoursey/next-themes); this drops just that one dev-only message.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Encountered a script tag while rendering React component")) {
      return;
    }
    original(...args);
  };
}

export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
