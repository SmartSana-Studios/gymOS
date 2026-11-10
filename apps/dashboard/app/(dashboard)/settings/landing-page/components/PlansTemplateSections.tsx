"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { LayoutTemplate, Tag } from "lucide-react";
import type { LandingPagePlan } from "@/services/landing-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import type { PageTemplateId } from "@/lib/pageTemplates";
import { SectionHeader } from "../../SectionHeader";
import { formatPrice } from "./pageCopy";
import { TemplatePickerDialog } from "./TemplatePickerDialog";
import { TemplateThumb } from "./TemplateThumb";

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

/**
 * The current template, with its thumbnail and a [Change template] button that opens the picker modal. The choice never asks for content
 * again. `pending` is a choice that is not saved yet (a page that is not live): it is used at the next publish.
 */
export function TemplateSection({
  selected,
  canChange,
  live,
  pending,
  onUse,
}: {
  selected: PageTemplateId;
  canChange: boolean;
  live: boolean;
  pending: boolean;
  onUse: (id: PageTemplateId) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const name = t(`pageEditor.templates.${selected}`);
  return (
    <Card id={PAGE_SECTION_IDS.template} data-testid="section-template">
      <SectionHeader icon={LayoutTemplate} accent="blue" title={t("pageEditor.sections.template")} description={t("pageEditor.sections.templateDescription")} />
      <CardContent className="space-y-3">
        <div data-testid={`template-${selected}`} data-selected="true" className="flex flex-wrap items-start gap-4 rounded-md border-2 border-primary p-3 text-sm">
          <div className="w-40 shrink-0">
            <TemplateThumb id={selected} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">
              {name}
              <span className="sr-only"> ({t("pageEditor.templates.selected", { name })})</span>
            </p>
            <p className="text-muted-foreground">{t(`pageEditor.templates.${selected}Description`)}</p>
            {pending && (
              <p className="text-amber-700 dark:text-amber-400" data-testid="template-pending">
                {t("pageEditor.templates.pendingNote", { name })}
              </p>
            )}
          </div>
          {canChange && (
            <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="template-change">
              {t("pageEditor.templates.change")}
            </Button>
          )}
        </div>
      </CardContent>
      {canChange && <TemplatePickerDialog key={open ? "open" : "closed"} open={open} onOpenChange={setOpen} selected={selected} live={live} onUse={onUse} />}
    </Card>
  );
}
