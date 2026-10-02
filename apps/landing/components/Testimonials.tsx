import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";
import { SHOW_TESTIMONIALS } from "@/lib/config";

/**
 * Real customer quotes. Renders nothing until there are some.
 *
 * Two independent guards, both of which must pass: `SHOW_TESTIMONIALS`
 * (NEXT_PUBLIC_SHOW_TESTIMONIALS, default off) and a non-empty `items` array
 * in lib/copy.ts. The array guard is the one that matters -- it makes
 * flipping the env var on an empty dictionary a no-op rather than a section
 * header floating above nothing.
 *
 * To ship real testimonials: add them to `testimonials.items` for BOTH
 * locales in lib/copy.ts (a quote given in French stays in French on the
 * French page; do not machine-translate a person's words and keep their name
 * under them), then set NEXT_PUBLIC_SHOW_TESTIMONIALS=true on the Vercel
 * project. Name and gym must be real and used with the person's permission.
 */
export function Testimonials({ copy }: { copy: Copy }) {
  if (!SHOW_TESTIMONIALS || copy.testimonials.items.length === 0) return null;

  return (
    <section className="relative">
      <Container className="py-20 sm:py-24">
        <div className="reveal">
          <SectionHeading
            eyebrow={copy.testimonials.eyebrow}
            title={copy.testimonials.title}
            subtitle={copy.testimonials.subtitle}
          />
        </div>
        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {copy.testimonials.items.map((item, index) => (
            <figure
              key={item.name}
              className="reveal flex h-full flex-col rounded-[1.5rem] border border-line bg-card/60 p-7"
              style={{ transitionDelay: `${index * 110}ms` }}
            >
              <blockquote className="flex-1 text-sm leading-relaxed text-muted">
                {item.quote}
              </blockquote>
              <figcaption className="mt-6 border-t border-line-soft pt-4">
                <span className="block text-sm font-semibold text-body">{item.name}</span>
                <span className="block text-sm text-faint">{item.gym}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}
