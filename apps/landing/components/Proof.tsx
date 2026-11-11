import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * The band a template fills with testimonials.
 *
 * These are the problems gym owners describe, written as problems -- not as
 * quotes attributed to named people. The distinction is the whole point: a
 * reader can tell this is GymOS describing the pain it sells against, which
 * is honest positioning, whereas the same sentences under an invented name
 * and gym would be a fabricated endorsement. Real quotes go in
 * `Testimonials` once a real gym owner gives one.
 */
export function Proof({ copy }: { copy: Copy }) {
  return (
    <section>
      <Container className="py-20 sm:py-28">
        <SectionHeading
          eyebrow={copy.proof.eyebrow}
          title={copy.proof.title}
          accent={copy.proof.titleAccent}
          subtitle={copy.proof.subtitle}
        />

        <div className="mt-16 grid md:grid-cols-3 md:divide-x md:divide-line">
          {copy.proof.items.map((item, index) => (
            <article
              key={item.title}
              className={`py-8 md:px-8 md:py-2 ${index === 0 ? "md:pl-0" : ""} ${
                index > 0 ? "border-t border-line md:border-t-0" : ""
              }`}
            >
              {/* Each item's own title already carries its locale's quotation
                  marks (straight in English, guillemets in French), so no
                  decorative quote glyph is added here. */}
              <h3 className="text-2xl font-extrabold leading-[1.15] tracking-[-0.02em]">{item.title}</h3>
              <p className="mt-4 text-lg leading-relaxed text-body">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
