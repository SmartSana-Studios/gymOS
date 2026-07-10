"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Slim bar at the top of the content area (not inside the Sidebar). Two
 * jobs: host the hamburger toggle that reveals the Sidebar as an overlay
 * at <768px, and an optional page-title slot -- gym name / user name /
 * role pill already live in the Sidebar itself (see Sidebar.tsx), so this
 * bar does not duplicate them.
 *
 * The hamburger is `md:hidden` (hidden at >=768px), matching the Sidebar
 * overlay's own `md:hidden` breakpoint exactly. Review finding: this
 * previously used `lg:hidden` on the whole bar, making the hamburger
 * visible but non-functional in the 768-1023px icon-rail range, where the
 * overlay it's meant to open never appears (it's `md:hidden`). No current
 * page passes `title`, so the bar itself stays hidden at >=1024px in that
 * case -- once a page does, the bar renders at every width to show it.
 */
export function TopBar({
  onOpenMobileNav,
  title,
}: {
  onOpenMobileNav: () => void;
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-14 items-center gap-3 border-b px-4",
        !title && "lg:hidden",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("topbar.openNavigationMenu")}
        onClick={onOpenMobileNav}
        className="md:hidden"
      >
        <Menu size={20} />
      </Button>
      {title && <h1 className="text-sm font-medium">{title}</h1>}
    </div>
  );
}
