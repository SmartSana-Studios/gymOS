import Image from "next/image";

/**
 * A very faint GymOS logo centred on the screen, behind nothing and above nothing that matters: it ignores clicks
 * (pointer-events-none), sits below the sticky bars and every dialog, and is hidden from assistive technology.
 * The source file is white, so light mode inverts it to dark; dark mode keeps it white.
 */
export function Watermark() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[5] flex items-center justify-center print:hidden">
      <div className="relative h-40 w-[min(70vw,560px)] opacity-[0.04] invert dark:invert-0">
        <Image src="/gymos-logo-full-white.webp" alt="" fill sizes="560px" className="object-contain" />
      </div>
    </div>
  );
}
