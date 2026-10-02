import Image from "next/image";
import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";
import { photo, type PhotoKey } from "@/lib/images";

const PILLAR_PHOTOS: PhotoKey[] = ["checkin", "members", "insights"];

export function Pillars({ copy }: { copy: Copy }) {
  return (
    <section id="features" className="relative">
      <Container className="py-20 sm:py-24">
        <div className="reveal">
          <SectionHeading
            eyebrow={copy.pillars.eyebrow}
            title={copy.pillars.title}
            accent={copy.pillars.titleAccent}
            subtitle={copy.pillars.subtitle}
          />
        </div>

        <div className="mt-16 grid gap-7 md:grid-cols-3">
          {copy.pillars.items.map((item, index) => (
            <article
              key={item.title}
              className="reveal group overflow-hidden rounded-[1.5rem] border border-line bg-card/60 transition-all duration-500 ease-smooth hover:-translate-y-1.5 hover:border-accent/35 hover:shadow-card"
              style={{ transitionDelay: `${index * 110}ms` }}
            >
              <div className="relative h-52 overflow-hidden">
                <Image
                  src={photo(PILLAR_PHOTOS[index] ?? "checkin", 900)}
                  alt={item.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-700 ease-smooth group-hover:scale-105"
                  unoptimized
                />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
                <span className="absolute bottom-4 left-5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-soft text-sm font-bold text-bg">
                  {index + 1}
                </span>
              </div>
              <div className="p-7">
                <h3 className="text-lg font-bold tracking-tight">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
