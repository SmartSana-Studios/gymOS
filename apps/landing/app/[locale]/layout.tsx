import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, Sora } from "next/font/google";
import { COPY } from "@/lib/copy";
import { isLocale, locales, type Locale, type LocaleRouteParams } from "@/lib/i18n";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gymosapps.com";

// Same pairing as the reference site: Sora for headlines, Inter for body.
const sora = Sora({
  variable: "--font-sora",
  display: "swap",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});

// This is the ROOT layout, nested under the [locale] segment rather than
// sitting at app/layout.tsx. Next explicitly supports that ("The root layout
// can also be nested in the new folder", node_modules/next/dist/docs/01-app/
// 02-guides/internationalization.md), and it is the only arrangement that
// lets <html lang> be correct: a nested layout cannot change the <html>
// element, so a single English root layout would have served the entire
// French page as lang="en" -- which is what screen readers and translation
// tooling actually read.
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleRouteParams): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const copy = COPY[locale];

  return {
    metadataBase: new URL(SITE_URL),
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: {
      canonical: `/${locale}`,
      // Declared on both locales so a crawler arriving on either is told
      // about the other. x-default is English, the language the domain is
      // handed out in.
      languages: { en: "/en", fr: "/fr", "x-default": "/en" },
    },
    openGraph: {
      type: "website",
      siteName: "GymOS",
      title: copy.meta.title,
      description: copy.meta.description,
      url: `${SITE_URL}/${locale}`,
      locale: locale === "fr" ? "fr_FR" : "en_US",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleRouteParams & { children: React.ReactNode }) {
  const { locale } = await params;
  // A hand-typed /de or /es reaches this layout with an unsupported segment.
  // 404 rather than falling back to English, so a wrong URL is visibly wrong
  // instead of quietly serving the wrong language under the right-looking path.
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale as Locale}>
      <body className={`${sora.variable} ${inter.variable} font-sans`}>{children}</body>
    </html>
  );
}
