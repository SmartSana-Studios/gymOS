import Image from "next/image";
import { Container, Eyebrow } from "./primitives";
import type { Copy } from "@/lib/copy";
import { photo } from "@/lib/images";

export function About({ copy }: { copy: Copy }) {
  return (
    <section id="about" className="relative">
      <Container className="grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <div className="reveal relative order-2 lg:order-1">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-line">
            <Image
              src={photo("about", 1100)}
              alt={copy.about.imageAlt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-tr from-bg/80 via-bg/20 to-transparent" />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -left-10 -z-10 h-56 w-56 rounded-full bg-accent/15 blur-3xl"
          />
        </div>

        <div className="reveal order-1 lg:order-2">
          <Eyebrow>{copy.about.eyebrow}</Eyebrow>
          <h2 className="mt-5 text-balance text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">
            {copy.about.title}{" "}
            <span className="bg-gradient-to-br from-accent to-accent-soft bg-clip-text text-transparent">
              {copy.about.titleAccent}
            </span>
          </h2>
          {copy.about.body.map((paragraph) => (
            <p key={paragraph} className="mt-5 text-pretty leading-relaxed text-muted">
              {paragraph}
            </p>
          ))}
          <ul className="mt-8 grid gap-3.5 sm:grid-cols-2">
            {copy.about.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-body">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3 w-3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
