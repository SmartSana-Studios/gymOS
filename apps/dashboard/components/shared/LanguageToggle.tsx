"use client";

import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";
import { updateLanguagePreference } from "@/app/(dashboard)/actions";

/**
 * EN | FR language toggle. `i18n.changeLanguage()` re-renders every mounted
 * Client Component instantly (both locales' resources are already preloaded,
 * lib/i18n/client-provider.tsx) -- the Server Action + router refresh persist
 * the choice and re-render the Server Component tree (e.g. Overview's
 * heading) against the now-updated `users.preferred_language` row, matching
 * FR-063's "no reload" language-change UX.
 *
 * Lives in the TopBar rather than the Sidebar footer, alongside the theme
 * switch and profile. That move is why the button colours are theme tokens
 * (`muted-foreground`/`foreground`) rather than the `primary-foreground`
 * shades the original sidebar placement used: on the top bar's --background
 * surface those near-white shades were effectively invisible in light mode.
 * The `railAware` prop went with the move -- there is no icon rail to
 * collapse into up here.
 */
export function LanguageToggle() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleChange(next: Locale) {
    if (next === i18n.language || pending) return;
    const previous = i18n.language;
    setPending(true);
    i18n.changeLanguage(next);
    try {
      const { error } = await updateLanguagePreference(next);
      if (error) {
        i18n.changeLanguage(previous);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-0.5 text-xs">
      {(["en", "fr"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          disabled={pending}
          aria-pressed={i18n.language === code}
          className={cn(
            "rounded px-1.5 py-1 uppercase text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            i18n.language === code && "bg-muted font-semibold text-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
