"use client";

import { useTranslation } from "react-i18next";
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "./SectionHeader";

export function StaffSection({ staffCount }: { staffCount: number }) {
  const { t } = useTranslation();
  return (
        <Card>
          <SectionHeader
            icon={Users}
            accent="cyan"
            title={t("settings.sections.staff")}
            description={t("settings.sectionDescriptions.staff")}
          />
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">{t("settings.staffSummary", { count: staffCount })}</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/staff">
                  {t("settings.manageStaffLink")}
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
  );
}
