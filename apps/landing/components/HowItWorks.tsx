import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

export function HowItWorks({ copy }: { copy: Copy }) {
  return (
    <section id="how" className="bg-sand">
      <Container className="py-20 sm:py-24">
        <SectionHeading title={copy.how.title} subtitle={copy.how.subtitle} />
        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {copy.how.steps.map((step, index) => (
            <li key={step.title} className="relative">
              <span className="text-5xl font-semibold tabular-nums text-accent/35">
                {index + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
