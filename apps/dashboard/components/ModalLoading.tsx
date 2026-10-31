"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Shown while a lazily loaded modal's code downloads (slow connections). The spinner and card use the primary
 * colour and a border so they stay visible on the light theme's paper-white background as well as in dark.
 */
export function ModalLoading() {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-card px-5 py-4 text-sm font-medium text-foreground shadow-lg">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        {t("network.loading")}
      </div>
    </div>
  );
}
