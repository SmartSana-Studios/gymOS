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
  return <div className={`mx-auto w-full max-w-content px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** The small accent-ruled label above each section heading, carried over
 *  from the reference's `.eyebrow`. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
      <span aria-hidden className="h-px w-7 bg-accent/60" />
      {children}
    </span>
  );
}

/** Section heading. `accent` is the trailing fragment that takes the orange
 *  gradient, matching the reference's `.grad-text` treatment on the second
 *  half of each headline. */
export function SectionHeading({
  eyebrow,
  title,
  accent,
  subtitle,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  const wrapper = align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl";
  return (
    <div className={wrapper}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-5 text-balance text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl lg:text-[2.75rem]">
        {title}
        {accent ? (
          <>
            {" "}
            <span className="bg-gradient-to-br from-accent to-accent-soft bg-clip-text text-transparent">
              {accent}
            </span>
          </>
        ) : null}
      </h2>
      {subtitle ? (
        <p className="mt-5 text-pretty text-base leading-relaxed text-muted sm:text-lg">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-all duration-300 ease-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

const BUTTON_VARIANTS = {
  primary:
    "bg-gradient-to-br from-accent to-accent-soft text-bg hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(224,151,31,0.4)] focus-visible:outline-accent",
  ghost:
    "border border-line text-body hover:-translate-y-0.5 hover:border-accent/50 hover:text-accent focus-visible:outline-accent",
} as const;

export function Button({
  href,
  children,
  variant = "primary",
  external = false,
  className = "",
  withArrow = false,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  external?: boolean;
  className?: string;
  withArrow?: boolean;
}) {
  const classes = `group ${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`;
  const inner = (
    <>
      {children}
      {withArrow ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 ease-smooth group-hover:translate-x-1"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      ) : null}
    </>
  );

  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}
