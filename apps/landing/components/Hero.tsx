import Image from "next/image";
import { Button, Container, Eyebrow } from "./primitives";
import { QrMock } from "./QrMock";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP } from "@/lib/config";
import { photo } from "@/lib/images";

/** One of the two stat cards that float either side of the scanner panel. */
function FloatChip({
  value,
  label,
  icon,
  className,
  delay,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
  className: string;
  delay: string;
}) {
  return (
    <div
      aria-hidden
      className={`motion-safe-only absolute z-20 hidden animate-floaty items-center gap-3 rounded-2xl border border-line bg-card/90 px-4 py-3 shadow-card backdrop-blur-md sm:flex ${className}`}
      style={{ animationDelay: delay }}
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
        {icon}
      </span>
      <span className="leading-tight">
        <strong className="block text-sm font-bold">{value}</strong>
        <span className="text-xs text-faint">{label}</span>
      </span>
    </div>
  );
}

export function Hero({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);
  const [sampleA, sampleB] = copy.hero.samples;
  const rows = [
    { sample: sampleA, src: photo("memberA", 80) },
    { sample: sampleB, src: photo("memberB", 80) },
  ];

  return (
    <section className="relative overflow-hidden">
      {/* Ambient wash behind the hero, matching the reference's radial
          gradients. Pure CSS rather than an image: this is the largest
          contentful paint on the page and a gym owner on a Cameroonian
          mobile connection pays for every unnecessary kilobyte here. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-48 -top-56 h-[42rem] w-[42rem] rounded-full bg-accent/[0.13] blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-72 -left-48 h-[38rem] w-[38rem] rounded-full bg-[#1d4ed8]/[0.12] blur-[120px]"
      />

      <Container className="relative grid items-center gap-16 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div className="reveal">
          <Eyebrow>{copy.hero.eyebrow}</Eyebrow>
          <h1 className="mt-6 text-balance text-[2.1rem] font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.55rem]">
            {copy.hero.titleLead}{" "}
            <span className="bg-gradient-to-br from-accent to-accent-soft bg-clip-text text-transparent">
              {copy.hero.titleAccent}
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            {copy.hero.subtitle}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Button href={contact.href} variant="primary" external withArrow>
              {HAS_WHATSAPP ? copy.hero.primaryCta : copy.hero.primaryCtaEmail}
            </Button>
            <Button href="#features" variant="ghost">
              {copy.hero.secondaryCta}
            </Button>
          </div>
        </div>

        {/* The scanner panel. Decorative as a whole -- every name and figure
            in it is sample data illustrating the product, the way a dashboard
            screenshot carries placeholder rows. */}
        <div className="reveal relative mx-auto w-full max-w-md lg:max-w-none">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-[-6%] inset-y-[8%] rounded-[3rem] bg-accent/[0.10] blur-2xl"
          />

          {/* Both chips straddle a corner of the panel rather than sitting
              inside its bounds -- hung off the edge they read as part of the
              same mock console (which is how the reference composes them),
              and more practically they stop covering the panel's own title
              and status badges, which an inset position did. */}
          <FloatChip
            value="1,248"
            label={copy.hero.chipMembers}
            className="-left-5 -top-6 sm:-left-9"
            delay="0s"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
          {/* The reference's equivalent chip reads "0.8s avg. check-in time".
              That is a measured performance claim, and GymOS has not measured
              it -- so this one shows a count of today's scans instead, which
              is mock console data of exactly the kind the panel below it
              already displays, not an assertion about how fast the product
              is. */}
          <FloatChip
            value="37"
            label={copy.hero.chipScans}
            className="-bottom-6 -right-5 sm:-right-8"
            delay="1.4s"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" />
              </svg>
            }
          />

          <div className="relative z-10 rounded-[1.75rem] border border-line bg-card/80 p-6 shadow-card backdrop-blur-xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold">{copy.hero.demoTitle}</h2>
                <p className="mt-1 text-xs text-faint">{copy.hero.demoSubtitle}</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
                <i className="motion-safe-only h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
                {copy.hero.live}
              </span>
            </div>

            <div className="relative mx-auto my-7 w-[13.5rem] rounded-[1.1rem] bg-white p-5">
              {/* Four L-shaped corner brackets + the travelling scanline. */}
              <span aria-hidden className="pointer-events-none absolute -left-[7px] -top-[7px] h-6 w-6 rounded-tl-md border-l-[3px] border-t-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -right-[7px] -top-[7px] h-6 w-6 rounded-tr-md border-r-[3px] border-t-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -bottom-[7px] -left-[7px] h-6 w-6 rounded-bl-md border-b-[3px] border-l-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -bottom-[7px] -right-[7px] h-6 w-6 rounded-br-md border-b-[3px] border-r-[3px] border-accent" />
              <span
                aria-hidden
                className="motion-safe-only absolute inset-x-3 h-0.5 animate-scan rounded-full bg-accent shadow-[0_0_14px_3px_rgba(224,151,31,0.6)]"
              />
              <QrMock title={copy.hero.qrAlt} />
            </div>

            <ul className="space-y-2.5">
              {rows.map(({ sample, src }) => (
                <li
                  key={sample?.name}
                  className="flex items-center gap-3 rounded-2xl border border-line-soft bg-card2/70 px-3.5 py-3"
                >
                  <Image
                    src={src}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                    unoptimized
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <strong className="block truncate text-sm font-semibold">{sample?.name}</strong>
                    <span className="text-xs text-faint">{sample?.detail}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/12 px-2.5 py-1 text-[11px] font-semibold text-accent">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3 w-3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {copy.hero.checkedIn}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
