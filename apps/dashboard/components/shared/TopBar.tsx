"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LanguageToggle } from "@/components/shared/LanguageToggle";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import type { MemberRole } from "@/services/session";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

const ROLE_LABEL_KEY: Record<MemberRole, string> = {
  member: "role.member",
  coach: "role.coach",
  receptionist: "role.receptionist",
  manager: "role.manager",
  supervisor: "role.supervisor",
  owner: "role.owner",
};

/**
 * Persistent bar across the top of the content area, holding the account
 * controls: who is signed in, the language switch and the theme switch.
 *
 * It used to be `lg:hidden` unless a page passed a `title`, existing only to
 * host the mobile hamburger -- so on desktop there was no top bar at all and
 * these controls lived in the Sidebar footer. It is now always rendered,
 * because the controls it carries have to be reachable at every width.
 *
 * Log out deliberately stays in the Sidebar: it is a destructive action with
 * its own confirmation dialog, and keeping it out of a row of one-tap
 * switches makes it harder to hit by accident.
 */
export function TopBar({
  onOpenMobileNav,
  memberName,
  role,
  title,
}: {
  onOpenMobileNav: () => void;
  memberName: string;
  role: MemberRole;
  title?: string;
}) {
  const { t } = useTranslation();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
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

      {title && <h1 className="truncate text-sm font-medium">{title}</h1>}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <LanguageToggle />
        <ThemeToggle />

        <div className="ml-1 flex items-center gap-2 border-l pl-2 sm:ml-2 sm:pl-3">
          {/* Name and role are hidden on the narrowest screens, where the
              avatar alone identifies the session -- the full name stays
              available through its `title`. */}
          <div className="hidden min-w-0 flex-col items-end sm:flex">
            <span className="max-w-[160px] truncate text-sm font-medium leading-tight">
              {memberName}
            </span>
            <Badge variant="secondary" className="mt-0.5 text-[10px]">
              {t(ROLE_LABEL_KEY[role])}
            </Badge>
          </div>
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
            title={memberName}
          >
            {memberName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </div>
    </header>
  );
}
