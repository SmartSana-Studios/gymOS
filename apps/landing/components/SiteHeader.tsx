import Image from "next/image";
import Link from "next/link";
import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { DASHBOARD_URL } from "@/lib/config";

export function SiteHeader({ copy, locale }: { copy: Copy; locale: Locale }) {
  const other = otherLocale(locale);

  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-sand/85 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <Image
            src="/gymos-icon-blue.webp"
            alt="GymOS"
            width={32}
            height={32}
            className="rounded-lg"
            priority
          />
          <span className="text-lg font-semibold tracking-tight">GymOS</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-ink/70 md:flex">
          <a href="#features" className="transition-colors hover:text-ink">
            {copy.nav.features}
          </a>
          <a href="#how" className="transition-colors hover:text-ink">
            {copy.nav.how}
          </a>
          <a href="#app" className="transition-colors hover:text-ink">
            {copy.nav.app}
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={`/${other}`}
            aria-label={copy.nav.switchLabel}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 transition-colors hover:border-ink/35 hover:text-ink"
          >
            {copy.nav.switchTo}
          </Link>
          <a
            href={`${DASHBOARD_URL}/auth/login`}
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-ink-soft sm:text-sm"
          >
            {copy.nav.login}
          </a>
        </div>
      </Container>
    </header>
  );
}
