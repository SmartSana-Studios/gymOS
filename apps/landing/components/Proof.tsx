import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * The band a template puts testimonials in.
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
    <section className="bg-ink text-white">
      <Container className="py-20 sm:py-24">
        <SectionHeading title={copy.proof.title} subtitle={copy.proof.subtitle} tone="light" />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {copy.proof.items.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-7"
            >
              <h3 className="text-lg font-semibold leading-snug tracking-tight text-accent">
                {item.title}
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-white/70">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
