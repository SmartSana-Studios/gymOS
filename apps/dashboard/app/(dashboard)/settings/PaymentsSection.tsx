"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CreditCard } from "lucide-react";
import { connectGymPaymentCredentialsSchema } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type GymPaymentConnectionStatus } from "@/services/gym-payment-credentials";
import { SectionHeader } from "./SectionHeader";
import { connectPaymentProvider, disconnectPaymentProvider } from "./actions";

interface PaymentFieldErrors {
  apiKey?: string;
  businessId?: string;
  webhookSecret?: string;
}

// Review fix (Story 4.13): `connectGymPaymentCredentialsSchema`'s Zod
// messages are English-only and were previously shown to the user verbatim,
// bypassing i18n entirely despite Task 4's explicit requirement for
// localized dialog errors. Mapped by field + issue code instead, matching
// this file's own `NAN_FIELD_MESSAGE_KEYS` precedent for the main form.
const PAYMENT_FIELD_MESSAGE_KEYS: Record<keyof PaymentFieldErrors, { required: string; tooLong: string }> = {
  apiKey: {
    required: "settings.payments.apiKeyRequiredError",
    tooLong: "settings.payments.apiKeyTooLongError",
  },
  businessId: {
    required: "settings.payments.businessIdRequiredError",
    tooLong: "settings.payments.businessIdTooLongError",
  },
  webhookSecret: {
    required: "settings.payments.webhookSecretRequiredError",
    tooLong: "settings.payments.webhookSecretTooLongError",
  },
};

export function usePayments({
  initialConnection,
  showToast,
}: {
  initialConnection: GymPaymentConnectionStatus | null;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [paymentConnection, setPaymentConnection] = useState(initialConnection);
  const [paymentForm, setPaymentForm] = useState({ apiKey: "", businessId: "", webhookSecret: "" });
  const [paymentFieldErrors, setPaymentFieldErrors] = useState<PaymentFieldErrors>({});
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectDialogRef = useRef<HTMLDialogElement>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnectDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (connectOpen) {
      connectDialogRef.current?.showModal();
    }
  }, [connectOpen]);

  useEffect(() => {
    if (disconnectOpen) {
      disconnectDialogRef.current?.showModal();
    }
  }, [disconnectOpen]);

  function openConnectDialog() {
    setPaymentForm({ apiKey: "", businessId: "", webhookSecret: "" });
    setPaymentFieldErrors({});
    setPaymentFormError(null);
    setConnectOpen(true);
  }

  async function handleConnectSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Review fix (Story 4.13): the submit button's `disabled` prop is the
    // primary guard, but the handler itself didn't check -- a second Enter
    // keypress before React re-renders could reach this twice concurrently.
    if (connecting) return;
    setPaymentFieldErrors({});
    setPaymentFormError(null);

    const parsed = connectGymPaymentCredentialsSchema.safeParse(paymentForm);
    if (!parsed.success) {
      const errors: PaymentFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof PaymentFieldErrors;
        if (!errors[field]) {
          const keys = PAYMENT_FIELD_MESSAGE_KEYS[field];
          errors[field] = t(issue.code === "too_big" ? keys.tooLong : keys.required);
        }
      }
      setPaymentFieldErrors(errors);
      return;
    }

    setConnecting(true);
    try {
      const { data, error } = await connectPaymentProvider(parsed.data);
      if (error || !data) {
        setPaymentFormError(error?.message ?? t("common.somethingWentWrong"));
        return;
      }
      setPaymentConnection(data.status);
      // Review fix (Story 4.13): `setConnectOpen(false)` alone doesn't close
      // the native <dialog> opened via showModal() -- only the Cancel button
      // and Escape key did, via the onClose handler below. Without this, the
      // modal stayed visually open (still blocking the page) after a
      // successful connect.
      connectDialogRef.current?.close();
      setConnectOpen(false);
      showToast(t("settings.payments.connectedToast"));
    } catch {
      setPaymentFormError(t("common.somethingWentWrong"));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnectConfirm() {
    setDisconnecting(true);
    try {
      const { error } = await disconnectPaymentProvider();
      if (error) {
        showToast(t("settings.payments.disconnectFailedToast"));
        return;
      }
      setPaymentConnection(null);
      showToast(t("settings.payments.disconnectedToast"));
    } catch {
      showToast(t("settings.payments.disconnectFailedToast"));
    } finally {
      // Review fix (Story 4.13): same dialog-not-actually-closed gap as
      // handleConnectSubmit above, on both the success and failure paths.
      disconnectDialogRef.current?.close();
      setDisconnecting(false);
      setDisconnectOpen(false);
    }
  }

  return {
    paymentConnection,
    paymentForm,
    setPaymentForm,
    paymentFieldErrors,
    paymentFormError,
    setConnectOpen,
    connecting,
    connectDialogRef,
    setDisconnectOpen,
    disconnecting,
    disconnectDialogRef,
    openConnectDialog,
    handleConnectSubmit,
    handleDisconnectConfirm,
  };
}

type PaymentsState = ReturnType<typeof usePayments>;

export function PaymentsCard({ payments }: { payments: PaymentsState }) {
  const { t } = useTranslation();
  const { paymentConnection, setDisconnectOpen, openConnectDialog } = payments;
  return (
        <Card>
          <SectionHeader
            icon={CreditCard}
            accent="teal"
            title={t("settings.sections.payments")}
            description={t("settings.sectionDescriptions.payments")}
          />
          <CardContent>
            {paymentConnection ? (
              <div className="flex flex-col gap-3">
                {paymentConnection.needsAttention && (
                  <div
                    className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{t("settings.payments.needsAttention")}</span>
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {t("settings.payments.connectedLabel", { businessId: paymentConnection.businessIdMasked })}
                    </p>
                    <p className="text-muted-foreground">
                      {t("settings.payments.connectedSince", {
                        date: new Date(paymentConnection.connectedAt).toLocaleDateString(),
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={openConnectDialog}>
                      {t("settings.payments.reconnect")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectOpen(true)}
                    >
                      {t("settings.payments.disconnect")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">{t("settings.payments.notConnected")}</p>
                <Button type="button" variant="outline" size="sm" onClick={openConnectDialog}>
                  {t("settings.payments.connect")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
  );
}

export function PaymentDialogs({ payments }: { payments: PaymentsState }) {
  const { t } = useTranslation();
  const { paymentForm, setPaymentForm, paymentFieldErrors, paymentFormError, setConnectOpen, connecting, connectDialogRef, setDisconnectOpen, disconnecting, disconnectDialogRef, handleConnectSubmit, handleDisconnectConfirm } = payments;
  return (
    <>
      <dialog
        ref={connectDialogRef}
        onClose={() => setConnectOpen(false)}
        onCancel={(e) => {
          if (connecting) e.preventDefault();
        }}
        className="w-full max-w-[440px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <form onSubmit={handleConnectSubmit} className="space-y-4 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("settings.payments.connectDialogTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.payments.connectDialogBody")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentApiKey">{t("settings.payments.apiKeyLabel")}</Label>
            <Input
              id="paymentApiKey"
              type="password"
              autoComplete="off"
              value={paymentForm.apiKey}
              onChange={(e) => setPaymentForm({ ...paymentForm, apiKey: e.target.value })}
            />
            {paymentFieldErrors.apiKey && <p className="text-sm text-red-600">{paymentFieldErrors.apiKey}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentBusinessId">{t("settings.payments.businessIdLabel")}</Label>
            <Input
              id="paymentBusinessId"
              value={paymentForm.businessId}
              onChange={(e) => setPaymentForm({ ...paymentForm, businessId: e.target.value })}
            />
            {paymentFieldErrors.businessId && (
              <p className="text-sm text-red-600">{paymentFieldErrors.businessId}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentWebhookSecret">{t("settings.payments.webhookSecretLabel")}</Label>
            <Input
              id="paymentWebhookSecret"
              type="password"
              autoComplete="off"
              value={paymentForm.webhookSecret}
              onChange={(e) => setPaymentForm({ ...paymentForm, webhookSecret: e.target.value })}
            />
            {paymentFieldErrors.webhookSecret && (
              <p className="text-sm text-red-600">{paymentFieldErrors.webhookSecret}</p>
            )}
          </div>

          {paymentFormError && <p className="text-sm text-red-600">{paymentFormError}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={connecting}
              onClick={() => connectDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={connecting}>
              {connecting ? t("settings.payments.connecting") : t("settings.payments.connect")}
            </Button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={disconnectDialogRef}
        onClose={() => setDisconnectOpen(false)}
        onCancel={(e) => {
          if (disconnecting) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("settings.payments.disconnectConfirmTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.payments.disconnectConfirmBody")}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disconnecting}
              onClick={() => disconnectDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={disconnecting} onClick={handleDisconnectConfirm}>
              {disconnecting ? t("settings.payments.disconnecting") : t("settings.payments.disconnect")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
