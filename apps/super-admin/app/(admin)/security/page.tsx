import { Suspense } from "react";

import { listFactors } from "./actions";
import { SecurityClient } from "./SecurityClient";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

export default function SecurityPage() {
  return (
    <Suspense fallback={null}>
      <SecurityData />
    </Suspense>
  );
}

async function SecurityData() {
  const { data, error } = await listFactors();
  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  return <SecurityClient initialFactors={data ?? []} />;
}
