import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { I18nClientProvider } from "@/lib/i18n/client-provider";
import { QueryProvider } from "@/lib/query-provider";
import "./globals.css";

/**
 * Origin that `metadataBase` makes every metadata URL absolute against --
 * most importantly `og:image`, which a link-preview crawler (WhatsApp,
 * Slack, iMessage) fetches as its own separate request.
 *
 * Deliberately NOT `VERCEL_URL` alone, which is what this used to be.
 * `VERCEL_URL` is the *deployment-specific* hostname
 * (`gymosdashboard-<hash>-<scope>.vercel.app`), and those sit behind Vercel
 * deployment protection: a crawler asking for the image got Vercel's HTML
 * login page back, `content-type: text/html`, so WhatsApp had no image and
 * rendered no preview at all. The custom domain serves the same file as a
 * real `image/png`.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the project's production domain
 * (`owner.gymosapps.com`), is set automatically by Vercel, and is public --
 * so the correct behaviour needs no manual configuration. The explicit
 * override is first for anyone who needs to pin it; `VERCEL_URL` survives
 * last so preview deployments still produce *some* absolute URL rather
 * than falling back to localhost.
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
  title: "GymOS",
  // Shown as the preview's body text wherever the link is shared, so it is
  // written for a gym owner receiving it rather than as an internal label.
  description: "Gym management software for gym owners — QR code check-in, memberships, payments and classes.",
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
        <QueryProvider>{children}</QueryProvider>
      </ThemeProvider>
    </I18nClientProvider>
  );
}
