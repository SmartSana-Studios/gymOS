"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";

/**
 * next-themes has been wired up since the initial scaffold (app/layout.tsx,
 * `ThemeProvider attribute="class" defaultTheme="system"`) but had no
 * user-facing control -- the only way to see dark mode was an OS-level
 * `prefers-color-scheme` change, which is how the app-wide `.dark`
 * theme-variable bug (tailwind.config.ts's missing `safelist: ["dark"]`,
 * fixed alongside this) went unnoticed. This gives users an explicit
 * light/dark switch instead of relying on the OS setting alone.
 *
 * Rendered only after mount (`mounted` guard): next-themes cannot know the
 * resolved theme during SSR/first paint without risking a hydration
 * mismatch (the server has no OS preference to read), so this renders a
 * fixed-size placeholder for one frame rather than guessing the wrong icon.
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
    return <div className="h-7 w-7" aria-hidden="true" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? t("nav.switchToLightTheme") : t("nav.switchToDarkTheme")}
      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
