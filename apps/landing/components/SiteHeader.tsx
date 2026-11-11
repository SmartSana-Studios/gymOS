"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { DASHBOARD_URL } from "@/lib/config";

/**
 * Sticky header on a solid navy ground, continuous with the hero. A client component only for the
 * mobile menu's open/closed state; there is no scroll listener and no blur,
 * so the bar is the same at the top of the page and a screen down.
 */
// Takes only `copy.nav` plus the one resolved contact action, not the whole
// dictionary. This is the page's one client component, so every prop it
// receives is serialised into the RSC payload embedded in the HTML.
export function SiteHeader({
  nav,
  locale,
  contact,
}: {
  nav: Copy["nav"];
  locale: Locale;
  contact: { href: string; label: string };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const other = otherLocale(locale);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const links = [
    { href: "#features", label: nav.features },
    { href: "#how", label: nav.how },
    { href: "#app", label: nav.app },
    { href: "#about", label: nav.about },
  ];

  return (
    <header className="on-navy sticky top-0 z-50 border-b border-navy-line bg-navy-deep">
      <Container className="flex h-[68px] items-center justify-between gap-4">
        <Link href={`/${locale}`} className="flex min-h-11 items-center gap-2.5">
          <Image
            src="/gymos-icon-white.webp"
            alt="GymOS"
            width={36}
            height={36}
            className="rounded-[9px]"
            priority
          />
          <span className="font-display text-xl font-extrabold tracking-[-0.02em] text-on-navy">GymOS</span>
        </Link>

        <nav className="hidden items-center gap-2 text-[0.9375rem] font-medium text-on-navy-muted xl:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3.5 transition-colors hover:text-on-navy">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={`/${other}`}
            aria-label={nav.switchLabel}
            className="inline-flex min-h-11 items-center rounded-xl border border-on-navy-muted/60 px-3.5 text-sm font-semibold text-on-navy transition-colors hover:border-on-navy"
          >
            {nav.switchTo}
          </Link>
          <a
            href={`${DASHBOARD_URL}/auth/login`}
            className="hidden min-h-11 items-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap text-on-navy transition-colors hover:text-accent sm:inline-flex"
          >
            {nav.login}
          </a>
          <a
            href={contact.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold whitespace-nowrap text-navy-deep transition-colors hover:bg-accent-hover md:inline-flex"
          >
            {contact.label}
          </a>
          {/* Below 768 px the contact action stays in the bar as an icon
              button, so it is one tap from anywhere on the page. */}
          <a
            href={contact.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={contact.label}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-navy-deep transition-colors hover:bg-accent-hover md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5">
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-4-1L3 20l1.1-4.6a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 11.5 3h.5a8.4 8.4 0 0 1 9 8z" />
            </svg>
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? nav.closeMenu : nav.openMenu}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-on-navy-muted/60 text-on-navy xl:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
              className="h-5 w-5"
            >
              {menuOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </Container>

      {menuOpen ? (
        <nav id="mobile-menu" className="border-t border-navy-line bg-navy-deep xl:hidden">
          <Container className="flex flex-col py-2">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="py-3.5 text-base font-medium text-on-navy-muted transition-colors hover:text-on-navy"
              >
                {link.label}
              </a>
            ))}
            <a
              href={`${DASHBOARD_URL}/auth/login`}
              className="py-3.5 text-base font-medium text-on-navy-muted transition-colors hover:text-on-navy"
            >
              {nav.login}
            </a>
            <a
              href={contact.href}
              target="_blank"
              rel="noopener noreferrer"
              className="my-3 inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 text-base font-semibold text-navy-deep"
            >
              {contact.label}
            </a>
          </Container>
        </nav>
      ) : null}
    </header>
  );
}
