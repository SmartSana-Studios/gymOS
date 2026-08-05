import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;
  const { t } = await getServerTranslation(await getRequestLocale());

  return (
    <>
      {params?.error ? (
        <p className="text-sm text-muted-foreground">{t("auth.errorCode", { code: params.error })}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("auth.unspecifiedError")}</p>
      )}
    </>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const { t } = await getServerTranslation(await getRequestLocale());
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("auth.errorTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense>
            <ErrorContent searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
