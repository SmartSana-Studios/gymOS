import Image from "next/image";
import { Button, Container, Eyebrow } from "./primitives";
import { QrMock } from "./QrMock";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP } from "@/lib/config";
import { photo } from "@/lib/images";

/** A sample-data chip attached to a side of the check-in panel. Static: it is
 *  part of the illustration, not a floating widget. */
function PanelChip({
  value,
  label,
  icon,
  className,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
  className: string;
}) {
  return (
    <div
      aria-hidden
      className={`absolute z-20 hidden items-center gap-3 rounded-xl bg-surface px-4 py-3 shadow-card xl:flex ${className}`}
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-tint text-accent-ink">
        {icon}
      </span>
      <span className="leading-tight">
        <strong className="block font-display text-base font-bold text-ink">{value}</strong>
        <span className="text-xs text-muted">{label}</span>
      </span>
    </div>
  );
}

export function Hero({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);
  const [sampleA, sampleB] = copy.hero.samples;
  const rows = [
    { sample: sampleA, src: photo("memberA", 80), motion: "motion-safe:animate-settle-a" },
    { sample: sampleB, src: photo("memberB", 80), motion: "motion-safe:animate-settle-b" },
  ];

  return (
    <section className="on-navy relative overflow-hidden bg-navy-deep">
      {/* From 1280 px the photo owns the right 45% of the hero, edge to edge;
          the panel straddles its left seam. Under 1280 px the photo is a band
          between the text and the panel instead. Plain photograph, no scrim:
          no text sits on it. */}
      <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[45%] xl:block">
        <Image
          src={photo("heroGym", 1100)}
          alt=""
          fill
          sizes="45vw"
          className="object-cover object-[88%_50%]"
          priority
          unoptimized
        />
      </div>

      <Container className="relative grid items-center gap-12 py-14 sm:py-20 lg:min-h-[44rem] lg:grid-cols-[1.08fr_0.92fr] lg:gap-10 lg:py-24">
        <div>
          <Eyebrow onNavy>{copy.hero.eyebrow}</Eyebrow>
          <h1 className="mt-4 text-[2.5rem] font-extrabold leading-[1.02] tracking-[-0.03em] text-on-navy sm:text-6xl lg:text-[4rem] xl:text-[4.5rem]">
            {copy.hero.titleLead} <span className="text-accent">{copy.hero.titleAccent}</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-on-navy-muted sm:text-lg">
            {copy.hero.subtitle}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button href={contact.href} variant="primary" external withArrow>
              {HAS_WHATSAPP ? copy.hero.primaryCta : copy.hero.primaryCtaEmail}
            </Button>
            <Button href="#features" variant="onNavy">
              {copy.hero.secondaryCta}
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-[28rem] lg:justify-self-center xl:-translate-x-20">
          {/* Under 1280 px: the photo band the panel overlaps. */}
          <div aria-hidden className="relative -mx-5 mb-[-4.5rem] aspect-[16/8] overflow-hidden sm:mx-0 sm:rounded-2xl xl:hidden">
            <Image
              src={photo("heroGym", 800)}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 28rem"
              className="object-cover object-[62%_50%]"
              unoptimized
            />
          </div>

          <PanelChip
            value="1,248"
            label={copy.hero.chipMembers}
            className="-left-14 top-[36%]"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
          {/* The count of today's scans is mock console data like the rows
              below it, not a measured performance claim. */}
          <PanelChip
            value="37"
            label={copy.hero.chipScans}
            className="-right-12 top-[42%]"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" />
              </svg>
            }
          />

          {/* The check-in panel. Decorative as a whole: every name and figure
              in it is sample data illustrating the product, the way a
              dashboard screenshot carries placeholder rows. */}
          <div aria-hidden className="relative z-10 rounded-2xl bg-surface p-6 shadow-panel sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold">{copy.hero.demoTitle}</h2>
                <p className="mt-1 text-sm text-muted">{copy.hero.demoSubtitle}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent-tint px-3 py-1.5 text-xs font-semibold text-accent-ink">
                <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-live" />
                {copy.hero.live}
              </span>
            </div>

            <div className="relative mx-auto my-8 w-[13.5rem] rounded-xl border border-line bg-surface p-5">
              {/* Four L-shaped corner brackets and the scan line, which
                  sweeps the code continuously (motion-safe only). */}
              <span aria-hidden className="pointer-events-none absolute -left-[7px] -top-[7px] h-6 w-6 rounded-tl-md border-l-[3px] border-t-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -right-[7px] -top-[7px] h-6 w-6 rounded-tr-md border-r-[3px] border-t-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -bottom-[7px] -left-[7px] h-6 w-6 rounded-bl-md border-b-[3px] border-l-[3px] border-accent" />
              <span aria-hidden className="pointer-events-none absolute -bottom-[7px] -right-[7px] h-6 w-6 rounded-br-md border-b-[3px] border-r-[3px] border-accent" />
              <span
                aria-hidden
                className="absolute inset-x-3 top-[14px] hidden h-0.5 rounded-full bg-accent motion-safe:block motion-safe:animate-scan"
              />
              <QrMock title={copy.hero.qrAlt} />
            </div>

            <ul className="space-y-2.5">
              {rows.map(({ sample, src, motion }) => (
                <li
                  key={sample?.name}
                  className={`flex items-center gap-3 rounded-xl bg-bg px-3.5 py-3 ${motion}`}
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
                    <strong className="block truncate text-sm font-semibold text-ink">{sample?.name}</strong>
                    <span className="text-sm text-muted">{sample?.detail}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-1 text-xs font-semibold text-accent-ink">
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
