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
    <section>
      <Container className="py-20 sm:py-28">
        <SectionHeading
          eyebrow={copy.testimonials.eyebrow}
          title={copy.testimonials.title}
          subtitle={copy.testimonials.subtitle}
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {copy.testimonials.items.map((item) => (
            <figure key={item.name} className="flex h-full flex-col rounded-2xl bg-surface p-7 shadow-card">
              <blockquote className="flex-1 leading-relaxed text-body">{item.quote}</blockquote>
              <figcaption className="mt-6 border-t border-line pt-4">
                <span className="block font-semibold text-ink">{item.name}</span>
                <span className="block text-sm text-muted">{item.gym}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}
