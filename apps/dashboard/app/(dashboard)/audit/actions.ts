"use server";

import { exportAuditLogCsv, type ExportAuditLogCsvResult } from "@/services/auditLog";

// Story 7.2: Audit Log Dashboard Page. A deliberate, documented deviation
// from architecture.md:331's stale "no actions.ts" note for this route,
// which predates the Owner-only export requirement (AC #4) -- a Server
// Action is the only way to enforce that gate against a direct call, not
// just a hidden button. One thin passthrough function, mirroring
// subscriptions/actions.ts:54-59's exportSubscriptionsCsvAction -- all real
// logic (including the Owner-only role check) lives in exportAuditLogCsv
// (services/auditLog.ts), this file is a pure passthrough, same as every
// sibling actions.ts export wrapper.
export async function exportAuditLogCsvAction(params: {
  from?: string;
  to?: string;
  actorId?: string;
}): Promise<ExportAuditLogCsvResult> {
  return exportAuditLogCsv(params);
}
