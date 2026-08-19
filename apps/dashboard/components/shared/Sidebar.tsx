"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { MemberRole } from "@/services/session";
import {
  CalendarDays,
  ClipboardList,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  ScrollText,
  Settings,
  Tag,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./LanguageToggle";

// Role visibility matrix (EXPERIENCE.md, Admin Dashboard -- Sidebar). Kept
// as a flat, explicit table -- no derived "role level" abstraction that
// isn't in the spec. A Coach session matches only the last row. `labelKey`
// (not a literal label) since the translated string can only be looked up
// inside the component via useTranslation().
const NAV_ITEMS: {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: MemberRole[];
}[] = [
  { labelKey: "nav.overview", href: "/", icon: LayoutDashboard, roles: ["receptionist", "manager", "owner"] },
  { labelKey: "nav.members", href: "/members", icon: Users, roles: ["receptionist", "manager", "owner"] },
  { labelKey: "nav.plans", href: "/plans", icon: Tag, roles: ["manager", "owner"] },
  { labelKey: "nav.subscriptions", href: "/subscriptions", icon: CreditCard, roles: ["manager", "owner"] },
  { labelKey: "nav.payments", href: "/payments", icon: Wallet, roles: ["receptionist", "manager", "owner"] },
  { labelKey: "nav.attendance", href: "/attendance", icon: ClipboardList, roles: ["receptionist", "manager", "owner"] },
  { labelKey: "nav.classes", href: "/classes", icon: CalendarDays, roles: ["receptionist", "manager", "owner"] },
  { labelKey: "nav.auditLog", href: "/audit", icon: ScrollText, roles: ["manager", "owner"] },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, roles: ["owner"] },
  { labelKey: "nav.coachPortal", href: "/coach", icon: Dumbbell, roles: ["coach"] },
];

const ROLE_LABEL_KEY: Record<MemberRole, string> = {
  member: "role.member",
  coach: "role.coach",
  receptionist: "role.receptionist",
  manager: "role.manager",
  owner: "role.owner",
};

/**
 * Rendered twice: once inside the fixed `<aside>` (which becomes a 64px
 * icon-only rail at 768-1023px -- `railAware` hides labels below the `lg`
 * breakpoint there), and once inside the <768px overlay (`railAware=false`
 * -- an opened overlay is always the *full* sidebar per EXPERIENCE.md,
 * never a rail, regardless of viewport width).
 */
function SidebarContent({
  role,
  gymName,
  memberName,
  railAware,
  onNavigate,
}: {
  role: MemberRole;
  gymName: string;
  memberName: string;
  railAware: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const labelClass = railAware ? "hidden truncate lg:inline" : "truncate";

  return (
    <div className="flex h-full flex-col bg-primary text-primary-foreground">
      <div className="flex flex-col gap-1 border-b border-primary-foreground/10 p-4">
        <span className={cn("text-lg font-semibold", railAware && "hidden lg:inline")}>GymOS</span>
        <span
          className={cn(
            "max-w-[200px] truncate text-sm text-primary-foreground/70",
            railAware && "hidden lg:inline",
          )}
          title={gymName}
        >
          {gymName}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {items.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground",
                isActive &&
                  "border-l-[3px] border-accent bg-primary-foreground/10 pl-[9px] font-bold text-primary-foreground",
              )}
            >
              <Icon size={18} className="shrink-0" />
              <span className={labelClass}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <SidebarFooter role={role} memberName={memberName} railAware={railAware} />
    </div>
  );
}

export function Sidebar({
  role,
  gymName,
  memberName,
  isMobileOpen,
  onCloseMobile,
}: {
  role: MemberRole;
  gymName: string;
  memberName: string;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { t } = useTranslation();

  // Escape dismisses the mobile overlay, matching the native <dialog>
  // elements elsewhere in this codebase (Review finding: this overlay had
  // no keyboard dismissal path at all).
  useEffect(() => {
    if (!isMobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseMobile();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  return (
    <>
      {/* >=1024px: fixed 240px sidebar. 768-1023px: 64px icon rail. */}
      <aside className="hidden shrink-0 md:block md:w-16 lg:w-60">
        <SidebarContent
          role={role}
          gymName={gymName}
          memberName={memberName}
          railAware
          onNavigate={onCloseMobile}
        />
      </aside>

      {/* <768px: hidden unless opened, rendered as a left overlay with backdrop. */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("sidebar.navigationMenu")}
        >
          <div className="absolute inset-0 bg-black/50" onClick={onCloseMobile} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-60">
            <SidebarContent
              role={role}
              gymName={gymName}
              memberName={memberName}
              railAware={false}
              onNavigate={onCloseMobile}
            />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarFooter({
  role,
  memberName,
  railAware,
}: {
  role: MemberRole;
  memberName: string;
  railAware: boolean;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (confirming) {
      dialogRef.current?.showModal();
    }
  }, [confirming]);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Surface the failure and keep the dialog open (Review finding: this
      // previously had no error handling at all -- on rejection, nothing
      // was shown and the dialog never closed).
      setLogoutError(t("common.somethingWentWrong"));
      setLoggingOut(false);
      return;
    }
    router.push("/auth/login");
  }

  return (
    <div className="flex flex-col gap-3 border-t border-primary-foreground/10 p-4">
      <div className="flex items-center gap-2">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-xs font-semibold"
          title={memberName}
        >
          {memberName.slice(0, 1).toUpperCase()}
        </div>
        <div className={cn("flex min-w-0 flex-col", railAware && "hidden lg:flex")}>
          <span className="truncate text-sm font-medium">{memberName}</span>
          <Badge variant="secondary" className="w-fit text-[10px]">
            {t(ROLE_LABEL_KEY[role])}
          </Badge>
        </div>
      </div>

      <LanguageToggle railAware={railAware} />

      <Button
        type="button"
        variant="outline"
        size="sm"
        title={t("sidebar.logout")}
        className={cn(
          "bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground",
          railAware && "lg:w-full",
        )}
        onClick={() => setConfirming(true)}
      >
        <span className={railAware ? "hidden lg:inline" : undefined}>{t("sidebar.logout")}</span>
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setConfirming(false);
          setLogoutError(null);
        }}
        onCancel={(e) => {
          if (loggingOut) e.preventDefault();
        }}
        className="w-full max-w-[360px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("sidebar.logoutConfirmTitle")}</h2>
          {logoutError && <p className="text-sm text-destructive">{logoutError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loggingOut}
              onClick={() => dialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={loggingOut} onClick={handleLogout}>
              {loggingOut ? t("sidebar.loggingOut") : t("sidebar.logout")}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
