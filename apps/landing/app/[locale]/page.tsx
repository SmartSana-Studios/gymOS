import { notFound } from "next/navigation";
import { COPY } from "@/lib/copy";
import { isLocale, type LocaleRouteParams } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "@/components/Hero";
import { EarlyAccess } from "@/components/EarlyAccess";
import { Pillars } from "@/components/Pillars";
import { Proof } from "@/components/Proof";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { MemberApp } from "@/components/MemberApp";
import { Testimonials } from "@/components/Testimonials";
import { ClosingCta } from "@/components/ClosingCta";
import { SiteFooter } from "@/components/SiteFooter";

export default async function LandingPage({ params }: LocaleRouteParams) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = COPY[locale];

  return (
    <>
      <SiteHeader copy={copy} locale={locale} />
      <main>
        <Hero copy={copy} />
        <EarlyAccess copy={copy} />
        <Pillars copy={copy} />
        <Proof copy={copy} />
        <Features copy={copy} />
        <HowItWorks copy={copy} />
        <MemberApp copy={copy} />
        <Testimonials copy={copy} />
        <ClosingCta copy={copy} />
      </main>
      <SiteFooter copy={copy} />
    </>
  );
}
