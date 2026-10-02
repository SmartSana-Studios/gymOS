import Link from "next/link";
import type { ReactNode } from "react";

/** Page-width wrapper. One definition so every band lines up on the same
 *  gutters at every breakpoint. */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-content px-5 sm:px-8 ${className}`}>{children}</div>
  );
}

/** Section heading pair. Kept together because a title without its
 *  subtitle, or vice versa, has shown up in every hand-rolled landing page
 *  that did not have one. */
export function SectionHeading({
  title,
  subtitle,
  tone = "dark",
}: {
  title: string;
  subtitle: string;
  tone?: "dark" | "light";
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2
        className={`text-balance text-3xl font-semibold tracking-tight sm:text-4xl ${
          tone === "light" ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-4 text-pretty text-base leading-relaxed sm:text-lg ${
          tone === "light" ? "text-white/70" : "text-ink/65"
        }`}
      >
        {subtitle}
      </p>
    </div>
  );
}

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "accent" | "outline" | "light";
  /** External links get the full rel treatment. Internal anchors must not,
   *  or Next's Link prefetching is bypassed for no reason. */
  external?: boolean;
  className?: string;
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

const BUTTON_VARIANTS = {
  accent: "bg-accent text-ink hover:bg-accent-soft focus-visible:outline-accent",
  outline:
    "border border-white/25 text-white hover:bg-white/10 focus-visible:outline-white",
  light: "bg-white text-ink hover:bg-white/90 focus-visible:outline-white",
} as const;

export function Button({
  href,
  children,
  variant = "accent",
  external = false,
  className = "",
}: ButtonProps) {
  const classes = `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`;
  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
