"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PaymentProviderRow } from "@/services/payment-providers";
import { setActivePaymentProvider } from "../actions";

export function PaymentProvidersPageClient({
  initialProviders,
}: {
  initialProviders: PaymentProviderRow[];
}) {
  const { t } = useTranslation();
  const [activatingKey, setActivatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  async function handleActivate(providerKey: string) {
    setActivatingKey(providerKey);
    setError(null);
    try {
      const { error } = await setActivePaymentProvider({ providerKey });
      if (error) {
        setError(error.message);
        return;
      }
      router.refresh();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setActivatingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("paymentProviders.title")}</h1>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="divide-y rounded-md border">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>{t("paymentProviders.table.provider")}</span>
          <span>{t("paymentProviders.table.status")}</span>
          <span className="text-right">{t("paymentProviders.table.actions")}</span>
        </div>
        {initialProviders.map((provider) => (
          <div
            key={provider.id}
            className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 px-4 py-3"
          >
            <span>{provider.displayName}</span>
            <span>
              {provider.isActive ? (
                <Badge>{t("paymentProviders.statusActive")}</Badge>
              ) : (
                <Badge variant="secondary">{t("paymentProviders.statusInactive")}</Badge>
              )}
            </span>
            <span className="text-right">
              {!provider.isActive && (
                <Button
                  size="sm"
                  disabled={activatingKey !== null}
                  onClick={() => handleActivate(provider.providerKey)}
                >
                  {activatingKey === provider.providerKey
                    ? t("paymentProviders.activating")
                    : t("paymentProviders.activate")}
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
