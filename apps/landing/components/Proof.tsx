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
    <section className="relative border-y border-line bg-surface/40">
      <Container className="py-20 sm:py-24">
        <div className="reveal">
          <SectionHeading
            eyebrow={copy.proof.eyebrow}
            title={copy.proof.title}
            accent={copy.proof.titleAccent}
            subtitle={copy.proof.subtitle}
          />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {copy.proof.items.map((item, index) => (
            <article
              key={item.title}
              className="reveal relative rounded-[1.5rem] border border-line bg-card/60 p-7"
              style={{ transitionDelay: `${index * 110}ms` }}
            >
              {/* A decorative open-quote, as an expression rather than JSX
                  text so `i18next/no-literal-string` stays able to flag real
                  untranslated copy. Each proof item's own title already
                  carries its locale's quotation marks -- "..." in English,
                  « » in French -- so this mark is purely ornamental and is
                  hidden from assistive technology. */}
              <span aria-hidden className="font-display text-5xl leading-none text-accent/25">
                {"“"}
              </span>
              <h3 className="mt-2 text-base font-bold leading-snug tracking-tight text-accent">
                {item.title}
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-muted">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
