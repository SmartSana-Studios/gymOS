import { notFound } from "next/navigation";
import { COPY } from "@/lib/copy";
import { isLocale, type LocaleRouteParams } from "@/lib/i18n";
import { RevealOnScroll } from "@/components/Motion";
import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "@/components/Hero";
import { StatsStrip } from "@/components/StatsStrip";
import { EarlyAccess } from "@/components/EarlyAccess";
import { Pillars } from "@/components/Pillars";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { About } from "@/components/About";
import { MemberApp } from "@/components/MemberApp";
import { Proof } from "@/components/Proof";
import { Testimonials } from "@/components/Testimonials";
import { ClosingCta } from "@/components/ClosingCta";
import { SiteFooter } from "@/components/SiteFooter";

export default async function LandingPage({ params }: LocaleRouteParams) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = COPY[locale];

  return (
    <>
      <RevealOnScroll />
      <SiteHeader nav={copy.nav} locale={locale} />
      <main>
        <Hero copy={copy} />
        <StatsStrip copy={copy} />
        <EarlyAccess copy={copy} />
        <Pillars copy={copy} />
        <Features copy={copy} />
        <HowItWorks copy={copy} />
        <About copy={copy} />
        <MemberApp copy={copy} />
        <Proof copy={copy} />
        <Testimonials copy={copy} />
        <ClosingCta copy={copy} />
      </main>
      <SiteFooter copy={copy} />
    </>
  );
}
