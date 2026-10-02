import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

export function Pillars({ copy }: { copy: Copy }) {
  return (
    <section id="features" className="bg-sand">
      <Container className="py-20 sm:py-24">
        <SectionHeading title={copy.pillars.title} subtitle={copy.pillars.subtitle} />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {copy.pillars.items.map((item, index) => (
            <article
              key={item.title}
              className="rounded-2xl border border-ink/10 bg-white p-7 shadow-[0_1px_2px_rgba(27,42,65,0.04)]"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
