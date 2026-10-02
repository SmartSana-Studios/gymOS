import Image from "next/image";
import { Button, Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP } from "@/lib/config";

export function Hero({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);

  return (
    <section className="relative overflow-hidden bg-ink text-white">
      {/* Warm accent wash behind the headline. Pure CSS rather than an image:
          the hero is the largest-contentful paint on this page and a gym
          owner on a Cameroonian mobile connection is the visitor who pays
          for every unnecessary kilobyte here. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-accent/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -left-32 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-3xl"
      />

      <Container className="relative grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
            {copy.hero.eyebrow}
          </p>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            {copy.hero.title}
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/75 sm:text-lg">
            {copy.hero.subtitle}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button href={contact.href} variant="accent" external>
              {HAS_WHATSAPP ? copy.hero.primaryCta : copy.hero.primaryCtaEmail}
            </Button>
            <Button href="#features" variant="outline">
              {copy.hero.secondaryCta}
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm">
            <Image
              src="/gymos-icon-white.webp"
              alt="GymOS"
              width={420}
              height={420}
              className="mx-auto h-auto w-full rounded-2xl"
              priority
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
