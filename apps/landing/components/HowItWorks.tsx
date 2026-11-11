import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

export function HowItWorks({ copy }: { copy: Copy }) {
  return (
    <section id="how">
      <Container className="py-20 sm:py-28">
        <SectionHeading
          eyebrow={copy.how.eyebrow}
          title={copy.how.title}
          subtitle={copy.how.subtitle}
        />

        {/* The steps are a real sequence, so they are numbered; the large
            numeral is the only decoration. */}
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {copy.how.steps.map((step, index) => (
            <li key={step.title}>
              <span
                aria-hidden
                className="block font-display text-[5.5rem] font-extrabold leading-[0.9] tracking-[-0.04em] text-accent-display"
              >
                {`${index + 1}`}
              </span>
              <h3 className="mt-5 border-t-2 border-ink pt-5 text-2xl font-extrabold tracking-[-0.02em]">
                {step.title}
              </h3>
              <p className="mt-3 text-lg leading-relaxed text-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
