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

/** The short label that sits above a section heading. It is dictionary copy
 *  (every section carries one in both languages), so it is rendered, but as
 *  quiet sentence-case text in the text-safe orange rather than as a ruled,
 *  tracked-out caps kicker. `onNavy` flips it for the dark bands. */
export function Eyebrow({
  children,
  onNavy = false,
  onAccent = false,
}: {
  children: ReactNode;
  onNavy?: boolean;
  onAccent?: boolean;
}) {
  const color = onAccent ? "text-navy-deep" : onNavy ? "text-accent" : "text-accent-ink";
  return <span className={`text-sm font-semibold ${color}`}>{children}</span>;
}

/** Section heading. `accent` is the trailing fragment of the headline; it
 *  takes the text-safe orange as a solid colour, never a gradient. */
export function SectionHeading({
  eyebrow,
  title,
  accent,
  subtitle,
  align = "center",
  tone = "light",
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
  align?: "center" | "left";
  /** `navy` flips the heading for the dark bands: white text, bright orange fragment. */
  tone?: "light" | "navy";
}) {
  const navy = tone === "navy";
  const wrapper = align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl";
  return (
    <div className={wrapper}>
      {eyebrow ? <Eyebrow onNavy={navy}>{eyebrow}</Eyebrow> : null}
      <h2
        className={`mt-3 text-[2rem] font-extrabold leading-[1.06] tracking-[-0.028em] sm:text-5xl lg:text-[3.25rem] ${
          navy ? "text-on-navy" : ""
        }`}
      >
        {title}
        {accent ? (
          <>
            {" "}
            <span className={navy ? "text-accent" : "text-accent-display"}>{accent}</span>
          </>
        ) : null}
      </h2>
      {subtitle ? (
        <p
          className={`mt-5 text-base leading-relaxed sm:text-lg ${navy ? "text-on-navy-muted" : "text-muted"}`}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-[0.9375rem] font-semibold transition-colors duration-200 ease-smooth";

const BUTTON_VARIANTS = {
  // Navy text on the orange fill: 7.09:1.
  primary: "bg-accent text-navy-deep hover:bg-accent-hover",
  ghost: "border border-line-strong bg-surface text-ink hover:border-ink",
  // Ghost button for the navy bands.
  onNavy: "border border-on-navy-muted/50 text-on-navy hover:border-on-navy",
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
          className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 ease-smooth group-hover:translate-x-0.5"
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
