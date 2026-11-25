"use client";

import Link from "next/link";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * Story 29.4 (UX AD-32): the Portal's sub-navigation in picker mode: Classes, then Members, and nothing else (no Overview: it carries recent progress
 * activity, which FR-247 excludes). Classes is the default tab. Every link keeps `?coach=`. Same landmark label and active/inactive classes as
 * CoachPortalNav; the active surface comes from the layout segment (null on /coach and the member's id on a member page are both Members; "overview"
 * lights neither). Must stay inside its own <Suspense> in coach/layout.tsx, like CoachPortalNav.
 */
export function CoachPickerNav() {
  const { t } = useTranslation();
  const segment = useSelectedLayoutSegment();
  const coach = useSearchParams().get("coach");
  const query = coach ? `?coach=${encodeURIComponent(coach)}` : "";

  const items = [
    { key: "classes", labelKey: "coach.picker.tab.classes", href: `/coach/classes${query}`, active: segment === "classes" },
    { key: "members", labelKey: "coach.picker.tab.members", href: `/coach${query}`, active: segment !== "classes" && segment !== "overview" },
  ];

  return (
    <nav aria-label={t("coachPortal.subNav.label")} className="flex gap-6 border-b pb-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "text-sm transition-colors",
            item.active
              ? "font-medium text-foreground underline underline-offset-8 decoration-2"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
