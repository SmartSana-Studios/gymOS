"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { DASHBOARD_URL } from "@/lib/config";

/**
 * Sticky header. A client component for two reasons the reference's own
 * `main.js` has too: it gains a solid background once the page scrolls past
 * the hero (otherwise the nav sits unreadable over the hero artwork), and it
 * owns the mobile menu's open/closed state.
 */
// Takes only `copy.nav`, not the whole dictionary. This is the page's one
// client component, so every prop it receives is serialised into the RSC
// payload embedded in the HTML -- handing it the full `Copy` object shipped
// every section's body text to the browser twice (once rendered, once as
// JSON), including the testimonial strings for a section that renders
// nothing.
export function SiteHeader({ nav, locale }: { nav: Copy["nav"]; locale: Locale }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const other = otherLocale(locale);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: "#features", label: nav.features },
    { href: "#how", label: nav.how },
    { href: "#app", label: nav.app },
    { href: "#about", label: nav.about },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ease-smooth ${
        scrolled ? "border-b border-line bg-bg/85 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <Container className="flex h-[76px] items-center justify-between gap-4">
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <Image
            src="/gymos-icon-white.webp"
            alt="GymOS"
            width={34}
            height={34}
            className="rounded-lg"
            priority
          />
          <span className="text-lg font-bold tracking-tight">GymOS</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted lg:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-body">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={`/${other}`}
            aria-label={nav.switchLabel}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent/50 hover:text-accent"
          >
            {nav.switchTo}
          </Link>
          <a
            href={`${DASHBOARD_URL}/auth/login`}
            className="hidden rounded-full bg-gradient-to-br from-accent to-accent-soft px-5 py-2.5 text-xs font-semibold text-bg transition-transform duration-300 ease-smooth hover:-translate-y-0.5 sm:inline-flex sm:text-sm"
          >
            {nav.login}
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? nav.closeMenu : nav.openMenu}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-body lg:hidden"
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
        <nav className="border-t border-line bg-bg/95 backdrop-blur-xl lg:hidden">
          <Container className="flex flex-col py-3">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="py-3 text-sm font-medium text-muted transition-colors hover:text-body"
              >
                {link.label}
              </a>
            ))}
            <a
              href={`${DASHBOARD_URL}/auth/login`}
              className="mt-2 rounded-full bg-gradient-to-br from-accent to-accent-soft px-5 py-3 text-center text-sm font-semibold text-bg sm:hidden"
            >
              {nav.login}
            </a>
          </Container>
        </nav>
      ) : null}
    </header>
  );
}
