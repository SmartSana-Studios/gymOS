import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { I18nClientProvider } from "@/lib/i18n/client-provider";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "GymOS",
  description: "Gym management dashboard",
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
