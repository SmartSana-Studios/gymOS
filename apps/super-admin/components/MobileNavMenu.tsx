"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, X } from "lucide-react";

import { AdminNavLink } from "@/components/AdminNavLink";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/logout-button";

/**
 * <768px hamburger trigger + slide-down overlay panel (user-requested
 * upgrade, 2026-09-07, from an earlier flex-wrap-only stop-gap). Mirrors
 * apps/dashboard's Sidebar.tsx overlay conventions -- Escape-to-close,
 * backdrop click, `role="dialog"`/`aria-modal` -- at a scale proportionate
 * to this app's flat, single-role nav. NOT a reuse of that component: it's
 * built around per-role item filtering and a gym switcher this app has
 * neither of (the original design reasoning for a flat nav here still
 * holds -- see `(admin)/layout.tsx`'s own comment).
 *
 * >=768px renders nothing -- `(admin)/layout.tsx` keeps the pre-existing
 * flat inline nav there via `hidden md:contents`, unchanged.
 */
export function MobileNavMenu({
  navLinks,
}: {
  navLinks: { href: string; label: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // Focus trap: role="dialog"/aria-modal="true" claims full modal
      // semantics, so Tab must not be able to reach elements behind the
      // backdrop (code review follow-up).
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  return (
    <div className="ml-auto md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded text-foreground hover:bg-muted"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.navigationMenu")}
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            className="absolute inset-x-0 top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b bg-background p-4 shadow-lg"
          >
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <AdminNavLink
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded px-3 py-2 hover:bg-muted"
                >
                  {link.label}
                </AdminNavLink>
              ))}
            </nav>
            <div className="mt-4 flex items-center gap-3 border-t pt-4">
              <LanguageToggle />
              <ThemeToggle />
            </div>
            <div className="mt-3">
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
