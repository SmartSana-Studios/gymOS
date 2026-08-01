"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Story 4.6: first use of TanStack Query in this codebase
 * (architecture.md lines 141, 176). One `QueryClient` per mount, created via
 * `useState` (not module scope) so it isn't shared across requests on the
 * server -- mirrors client-provider.tsx's own `useMemo`-once shape. Wired
 * into app/layout.tsx at the root so every dashboard page gets a query
 * client, not just Overview/Attendance (the only current consumers).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
