"use client";

import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";
import { updateLanguagePreference } from "@/app/(dashboard)/actions";

/**
 * EXPERIENCE.md, Admin Dashboard -- Sidebar: "EN | FR language toggle" in
 * the footer's bottom section. `i18n.changeLanguage()` re-renders every
 * mounted Client Component instantly (both locales' resources are already
 * preloaded, lib/i18n/client-provider.tsx) -- the Server Action + router
 * refresh persist the choice and re-render the Server Component tree
 * (e.g. Overview's heading) against the now-updated `users.preferred_language`
 * row, matching FR-063's "no reload" language-change UX.
 */
export function LanguageToggle({ railAware }: { railAware: boolean }) {
  const { i18n } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleChange(next: Locale) {
    if (next === i18n.language || pending) return;
    setPending(true);
    i18n.changeLanguage(next);
    await updateLanguagePreference(next);
    router.refresh();
    setPending(false);
  }

  return (
    <div className={cn("flex items-center gap-1 text-xs", railAware && "lg:justify-center")}>
      {(["en", "fr"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          disabled={pending}
          aria-pressed={i18n.language === code}
          className={cn(
            "rounded px-1.5 py-0.5 uppercase text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
            i18n.language === code && "bg-primary-foreground/20 font-semibold text-primary-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
