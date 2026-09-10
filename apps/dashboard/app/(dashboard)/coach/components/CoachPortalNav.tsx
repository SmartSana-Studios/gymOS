"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

// EXPERIENCE.md's Coach Portal sub-nav (FR-144), in its order.
const SUB_NAV_ITEMS = [
  { labelKey: "coachPortal.subNav.overview", href: "/coach/overview" },
  { labelKey: "coachPortal.subNav.myMembers", href: "/coach" },
  { labelKey: "coachPortal.subNav.myClasses", href: "/coach/classes" },
] as const;

/**
 * Story 17.3 (AC #7, #8): the Portal's own sub-navigation, rendered by
 * coach/layout.tsx on all four Portal routes.
 *
 * The active surface comes from the layout segment, not pathname prefixes:
 * `/coach` prefixes both of its siblings, so a prefix rule would light My
 * Members everywhere. The segment is `null` on `/coach` and the member's UUID
 * on `/coach/[memberId]`, and My Members owns both -- so it is simply
 * "neither of the other two", with no list of sibling routes to keep in step.
 *
 * Must stay inside its own <Suspense> in coach/layout.tsx: the hook suspends
 * on `/coach/[memberId]` under `cacheComponents` (see that file). Active and
 * inactive classes match apps/super-admin's AdminNavLink.
 */
export function CoachPortalNav() {
  const { t } = useTranslation();
  const segment = useSelectedLayoutSegment();
  const activeHref =
    segment === "overview" ? "/coach/overview" : segment === "classes" ? "/coach/classes" : "/coach";

  // Labelled because the sidebar is a <nav> too, and two unlabelled
  // landmarks are indistinguishable to a screen reader. Translated, never a
  // literal: the i18n lint rule does not check attributes.
  return (
    <nav aria-label={t("coachPortal.subNav.label")} className="flex gap-6 border-b pb-3">
      {SUB_NAV_ITEMS.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sm transition-colors",
              active
                ? "font-medium text-foreground underline underline-offset-8 decoration-2"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Reserves the sub-nav row while the segment resolves, so the page below does
 * not jump on the member-detail route. Carries no text. */
export function CoachPortalNavFallback() {
  return (
    <div className="flex gap-6 border-b pb-3" aria-hidden="true">
      {SUB_NAV_ITEMS.map((item) => (
        <div key={item.href} className="h-5 w-20 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}
