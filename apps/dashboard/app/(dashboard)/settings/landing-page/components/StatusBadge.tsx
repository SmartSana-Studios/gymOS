"use client";

import { useTranslation } from "react-i18next";
import { AlertTriangle, Ban, CheckCircle2, Circle, CircleDot, EyeOff, Globe, PauseCircle } from "lucide-react";
import type { PageStatusState } from "@gymos/types";
import { Badge } from "@/components/ui/badge";

const VIEW: Record<PageStatusState, { icon: typeof Circle; className: string }> = {
  not_started: { icon: Circle, className: "border-border text-muted-foreground" },
  in_progress: { icon: CircleDot, className: "border-border text-foreground" },
  ready: { icon: CheckCircle2, className: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100" },
  published: { icon: Globe, className: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100" },
  offline_gate: { icon: AlertTriangle, className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" },
  offline_suspended: { icon: PauseCircle, className: "border-border text-muted-foreground" },
  offline_name_released: { icon: EyeOff, className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" },
  taken_down: { icon: Ban, className: "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100" },
};

/** A status is always icon plus words, never colour alone. */
export function StatusBadge({ state }: { state: PageStatusState }) {
  const { t } = useTranslation();
  const { icon: Icon, className } = VIEW[state];
  return (
    <Badge variant="outline" className={`gap-1.5 ${className}`} data-testid="page-status-badge" data-state={state}>
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`pageEditor.status.${state}`)}
    </Badge>
  );
}
