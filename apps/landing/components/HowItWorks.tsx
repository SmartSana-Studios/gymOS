import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

export function HowItWorks({ copy }: { copy: Copy }) {
  return (
    <section id="how" className="relative">
      <Container className="py-20 sm:py-24">
        <div className="reveal">
          <SectionHeading
            eyebrow={copy.how.eyebrow}
            title={copy.how.title}
            subtitle={copy.how.subtitle}
          />
        </div>

        <ol className="mt-16 grid gap-10 md:grid-cols-3">
          {copy.how.steps.map((step, index) => (
            <li
              key={step.title}
              className="reveal relative"
              style={{ transitionDelay: `${index * 120}ms` }}
            >
              {/* The connecting rule between steps, on wide screens only --
                  stacked on mobile the steps read top-to-bottom and a
                  horizontal line would point at nothing. */}
              {index < copy.how.steps.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute left-16 right-0 top-7 hidden h-px bg-gradient-to-r from-accent/40 to-transparent md:block"
                />
              ) : null}
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 font-display text-xl font-extrabold text-accent">
                {`0${index + 1}`}
              </span>
              <h3 className="mt-6 text-lg font-bold tracking-tight">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
