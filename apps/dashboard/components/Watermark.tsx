"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";

/**
 * A very faint GymOS logo centred on the screen, behind nothing and above nothing that matters: it ignores clicks
 * (pointer-events-none), sits below the sticky bars and every dialog, and is hidden from assistive technology.
 * The source file is white, so light mode inverts it to dark; dark mode keeps it white.
 *
 * It is decoration, so it must never compete with the page's real content on a slow connection: it is not shown on
 * small screens, and elsewhere it mounts only once the page has finished loading.
 */
function subscribeLoaded(onChange: () => void) {
  window.addEventListener("load", onChange, { once: true });
  return () => window.removeEventListener("load", onChange);
}

export function Watermark() {
  // Ready once the page has finished loading; the server render never shows it.
  const ready = useSyncExternalStore(subscribeLoaded, () => document.readyState === "complete", () => false);

  if (!ready) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[5] hidden items-center justify-center md:flex print:hidden">
      <div className="relative h-40 w-[min(70vw,560px)] opacity-[0.04] invert dark:invert-0">
        <Image src="/gymos-logo-full-white.webp" alt="" fill sizes="560px" className="object-contain" />
      </div>
    </div>
  );
}
