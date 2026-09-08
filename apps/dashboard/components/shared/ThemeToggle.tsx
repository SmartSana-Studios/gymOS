"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";

/**
 * Light/dark switch for the dashboard top bar. `next-themes` has been wired
 * up since the initial scaffold (app/layout.tsx, `ThemeProvider
 * attribute="class" defaultTheme="system"`) but this app had no user-facing
 * control, so the only way to reach dark mode was an OS-level
 * `prefers-color-scheme` change -- which is why the sidebar rendering white
 * on a dark page went unnoticed for so long (Sidebar.tsx borrowed --primary,
 * which inverts between themes; it now has its own --sidebar tokens).
 *
 * Mirrors apps/super-admin/components/ThemeToggle.tsx per this codebase's
 * established per-app-copy convention for shared UI.
 *
 * Rendered only after mount: next-themes cannot know the resolved theme
 * during SSR without risking a hydration mismatch (the server has no OS
 * preference to read), so this holds a fixed-size placeholder for one frame
 * rather than guessing the wrong icon and flipping it.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="size-8" aria-hidden="true" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? t("topbar.switchToLightTheme") : t("topbar.switchToDarkTheme")}
      title={isDark ? t("topbar.switchToLightTheme") : t("topbar.switchToDarkTheme")}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
