"use client";

import { useEffect, useRef, useState } from "react";

/** True when the visitor has asked their OS to reduce motion. Read once per
 *  mount rather than subscribed to: this page's animations are decorative
 *  and nobody flips the setting mid-scroll. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Adds `is-visible` to every `.reveal` element as it scrolls into view, and
 * unobserves it immediately so nothing re-animates on the way back up.
 *
 * Mounted once at the page root rather than wrapping each section in its own
 * client component: the sections stay server-rendered (the whole page is
 * static HTML), and this ships one small observer instead of a client
 * boundary per band.
 *
 * The no-IntersectionObserver fallback reveals everything rather than
 * leaving it hidden -- an unsupported browser must get a readable page, not
 * a blank one.
 */
export function RevealOnScroll() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}

/**
 * Counts up to `value` the first time it is scrolled into view.
 *
 * Renders the final value as its initial state rather than 0, so the number
 * is already correct in the server-rendered HTML: a visitor with JS disabled,
 * a crawler, and anyone who scrolls past before hydration all see the real
 * figure instead of a stuck zero.
 */
export function Counter({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    // Counting to zero has nothing to animate, and starting it at 0 would
    // just blank the figure for a moment.
    if (value === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // The count starts from zero here, inside the observer callback,
        // rather than from a `setDisplay(0)` in the effect body -- setting
        // state directly in an effect makes React render twice on mount for
        // a purely decorative animation, and it would blank the figure for
        // any visitor who never scrolls this far.
        const start = performance.now();
        const duration = 1600;
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(Math.round(value * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return (
    <span ref={ref} className="tabular-nums">
      {`${display}${suffix}`}
    </span>
  );
}
