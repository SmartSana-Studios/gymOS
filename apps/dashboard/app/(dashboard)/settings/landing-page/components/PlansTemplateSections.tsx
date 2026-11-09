"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { LayoutTemplate, Tag } from "lucide-react";
import type { LandingPagePlan } from "@/services/landing-page";
import { Card, CardContent } from "@/components/ui/card";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import { PAGE_TEMPLATES, type PageTemplateId } from "@/lib/pageTemplates";
import { SectionHeader } from "../../SectionHeader";
import { formatPrice } from "./pageCopy";

const TYPE_KEY: Record<string, string> = {
  pay_per_session: "plans.types.payPerSession",
  monthly: "plans.types.monthly",
  coach_inclusive: "plans.types.coachInclusive",
  class_only: "plans.types.classOnly",
};

/** Every plan, read-only, with its own currency and ONE "Show on my page" switch (default off, no label fields). */
export function PlansSection({
  plans,
  values,
  onChange,
  canAddPlan,
}: {
  plans: LandingPagePlan[];
  values: Record<string, boolean>;
  onChange: (planId: string, value: boolean) => void;
  canAddPlan: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card id={PAGE_SECTION_IDS.plans} data-testid="section-plans">
      <SectionHeader icon={Tag} accent="teal" title={t("pageEditor.sections.plans")} description={t("pageEditor.sections.plansDescription")} />
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("pageEditor.plans.helper")}</p>
        {plans.length === 0 ? (
          <div className="space-y-2 text-sm">
            <p>{t("pageEditor.plans.empty")}</p>
            {canAddPlan && (
              <Link href="/plans" className="underline">
                {t("pageEditor.plans.add")}
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {plans.map((p) => {
              const on = values[p.id] ?? false;
              const price = formatPrice(p.price, p.currency, i18n.language);
              const per = p.planType === "pay_per_session" ? t("pageEditor.plans.perSession") : p.durationDays ? t("plans.durationDaysLabel", { days: p.durationDays }) : "";
              return (
                <li key={p.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="text-sm">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-muted-foreground">
                      {t(TYPE_KEY[p.planType] ?? "plans.types.monthly")} · {price}
                      {per ? ` / ${per}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm" aria-hidden="true">
                      {t("pageEditor.plans.show")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${t("pageEditor.plans.show")} - ${p.name}`}
                      onClick={() => onChange(p.id, !on)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${on ? "bg-primary" : "bg-muted"}`}
                    >
                      <span aria-hidden="true" className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The launch ships one template card; the choice never asks for content again. */
export function TemplateSection({ selected }: { selected: PageTemplateId }) {
  const { t } = useTranslation();
  return (
    <Card id={PAGE_SECTION_IDS.template} data-testid="section-template">
      <SectionHeader icon={LayoutTemplate} accent="blue" title={t("pageEditor.sections.template")} description={t("pageEditor.sections.templateDescription")} />
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-3">
          {PAGE_TEMPLATES.map((id) => (
            <div key={id} data-testid={`template-${id}`} data-selected={id === selected} className="rounded-md border-2 border-primary p-3 text-sm">
              <span className="font-medium">{t(`pageEditor.templates.${id}`)}</span>
              <span className="sr-only"> ({t("pageEditor.templates.selected")})</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t("pageEditor.templates.more")}</p>
      </CardContent>
    </Card>
  );
}
