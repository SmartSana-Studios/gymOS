import Image from "next/image";
import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";
import { photo, type PhotoKey } from "@/lib/images";

const PILLAR_PHOTOS: PhotoKey[] = ["checkin", "members", "insights"];

/**
 * Three reasons, set as three full-width rows: the photo runs edge to edge
 * on one half, the text sits on the other, and the sides alternate down the
 * page. Photos are requested at 900 px, which is all a half-width frame needs.
 */
export function Pillars({ copy }: { copy: Copy }) {
  return (
    <section id="features">
      <Container className="pb-14 pt-16 sm:pb-20 sm:pt-24">
        <SectionHeading
          eyebrow={copy.pillars.eyebrow}
          title={copy.pillars.title}
          accent={copy.pillars.titleAccent}
          subtitle={copy.pillars.subtitle}
        />
      </Container>

      <div>
        {copy.pillars.items.map((item, index) => {
          const flip = index % 2 === 1;
          return (
            <article
              key={item.title}
              className={`grid md:grid-cols-2 ${index % 2 === 0 ? "bg-surface" : "bg-bg"}`}
            >
              <div className={`relative aspect-[16/10] md:aspect-auto md:min-h-[26rem] ${flip ? "md:order-2" : ""}`}>
                <Image
                  src={photo(PILLAR_PHOTOS[index] ?? "checkin", 900)}
                  alt={item.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex flex-col justify-center px-5 py-12 sm:px-8 md:px-12 md:py-16 lg:px-20">
                <div className="max-w-md">
                  <h3 className="text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] sm:text-4xl">
                    {item.title}
                  </h3>
                  <p className="mt-5 text-lg leading-relaxed text-body">{item.body}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
