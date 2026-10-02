import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { I18nClientProvider } from "@/lib/i18n/client-provider";
import "./globals.css";

/**
 * Origin that `metadataBase` makes every metadata URL absolute against --
 * most importantly `og:image`, which a link-preview crawler fetches as its
 * own separate request.
 *
 * Deliberately NOT `VERCEL_URL` alone, which is what this used to be.
 * `VERCEL_URL` is the *deployment-specific* hostname, and those sit behind
 * Vercel deployment protection: a crawler asking for the image got Vercel's
 * HTML login page back instead of a PNG, so no preview rendered. See the
 * identical comment in apps/dashboard/app/layout.tsx -- duplicated per app
 * rather than shared, matching this codebase's existing per-app precedent
 * (AD-7).
 */
function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: "GymOS Super Admin",
  description: "Platform-wide gym onboarding, tiers, billing, and messaging administration",
  // This console is staff-only. Keeping it out of search results costs
  // nothing (nobody finds their way in by searching) and keeps the platform's
  // admin surface off the public record.
  robots: { index: false, follow: false },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <Suspense fallback={null}>
          <LocaleShell>{children}</LocaleShell>
        </Suspense>
      </body>
    </html>
  );
}

async function LocaleShell({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();

  return (
    <I18nClientProvider locale={locale}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </I18nClientProvider>
  );
}
