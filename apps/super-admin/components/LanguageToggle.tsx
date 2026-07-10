"use client";

import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";
import { updateLanguagePreference } from "@/app/(admin)/actions";

/**
 * EXPERIENCE.md, Super Admin Dashboard -- Sidebar: "Same structure as
 * Admin Dashboard sidebar" -- but `(admin)/layout.tsx` deliberately has no
 * Sidebar component (documented decision: one role, two flat destinations).
 * Resolved here as the same EN|FR toggle *behavior* in the flat top nav
 * instead of building a Sidebar just to match "same structure" literally.
 */
export function LanguageToggle() {
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
    <div className="ml-auto flex items-center gap-1 text-xs">
      {(["en", "fr"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          disabled={pending}
          aria-pressed={i18n.language === code}
          className={cn(
            "rounded px-1.5 py-0.5 uppercase text-muted-foreground hover:text-foreground",
            i18n.language === code && "bg-muted font-semibold text-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
