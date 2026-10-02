import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, Sora } from "next/font/google";
import { COPY } from "@/lib/copy";
import { isLocale, locales, type Locale, type LocaleRouteParams } from "@/lib/i18n";
import "./globals.css";

/**
 * Origin every metadata URL is made absolute against -- above all `og:image`,
 * which a link-preview crawler (WhatsApp, Slack, iMessage) fetches as its own
 * separate request and will not resolve from a relative path.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is Vercel's own production-domain variable:
 * public, set automatically, and crucially it is whichever host the project
 * actually serves as primary. That matters here because the apex
 * 308-redirects to `www.gymosapps.com`, so hardcoding the apex would hand
 * crawlers an image URL that redirects -- which some of them decline to
 * follow. Resolving it from Vercel keeps the metadata pointing at the host
 * that answers directly, whichever one that is.
 *
 * `VERCEL_URL` (the deployment-specific hostname) is last on purpose: those
 * sit behind deployment protection and answer a crawler with an HTML login
 * page rather than a PNG -- the exact failure this app's two siblings had.
 * It is kept only so preview deployments still emit an absolute URL.
 */
function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://gymosapps.com";
}

const SITE_URL = resolveSiteUrl();

/**
 * The share card, referenced explicitly rather than through Next's
 * `opengraph-image` file convention.
 *
 * The convention bit this app once already: the file sat at `app/`, the page
 * at `app/[locale]/`, and declaring an `openGraph` object in
 * `generateMetadata` without `images` left the built page with NO `og:image`
 * tag at all -- while `/opengraph-image.png` still returned a perfectly good
 * PNG, so every check short of reading the emitted `<meta>` tags looked
 * fine. An explicit path from `public/` has no such interaction.
 */
const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
} as const;

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
      images: [{ ...OG_IMAGE, alt: copy.meta.title }],
    },
    twitter: {
      // Without an image this degrades to the small "summary" card, which is
      // what the page was serving.
      card: "summary_large_image",
      title: copy.meta.title,
      description: copy.meta.description,
      images: [OG_IMAGE.url],
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
