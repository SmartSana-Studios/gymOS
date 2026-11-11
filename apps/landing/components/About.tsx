import Image from "next/image";
import { Eyebrow } from "./primitives";
import type { Copy } from "@/lib/copy";
import { photo } from "@/lib/images";

export function About({ copy }: { copy: Copy }) {
  return (
    <section id="about" className="grid bg-surface lg:grid-cols-2">
      <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-[34rem]">
        <Image
          src={photo("about", 1100)}
          alt={copy.about.imageAlt}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
          unoptimized
        />
      </div>

      <div className="flex flex-col justify-center px-5 py-14 sm:px-8 lg:px-16 lg:py-20 xl:px-24">
        <div className="max-w-xl">
          <Eyebrow>{copy.about.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-[2rem] font-extrabold leading-[1.06] tracking-[-0.028em] sm:text-5xl">
            {copy.about.title} <span className="text-accent-display">{copy.about.titleAccent}</span>
          </h2>
          {copy.about.body.map((paragraph) => (
            <p key={paragraph} className="mt-5 text-lg leading-relaxed text-body">
              {paragraph}
            </p>
          ))}
          <ul className="mt-9 grid gap-4 sm:grid-cols-2">
            {copy.about.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[0.9375rem] font-medium text-ink">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-ink">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3 w-3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
