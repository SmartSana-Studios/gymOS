import { Suspense } from "react";

import { getMessagingInstance } from "@/services/messaging-provider-config";
import { MessagingSettingsPageClient } from "./components/MessagingSettingsPageClient";
import MessagingLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 1.13 AC #1. Same Server Component + explicit <Suspense> pattern as
// payment-providers/page.tsx -- this app's `cacheComponents: true` requires
// the cookie-based Supabase read to sit inside an explicit Suspense
// boundary, not just rely on the route's loading.tsx.
export default function MessagingPage() {
  return (
    <Suspense fallback={<MessagingLoading />}>
      <MessagingData />
    </Suspense>
  );
}

async function MessagingData() {
  const { data, error } = await getMessagingInstance();

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <MessagingSettingsPageClient
      initialInstanceId={data?.instanceId ?? null}
      initialUpdatedAt={data?.updatedAt ?? null}
    />
  );
}
