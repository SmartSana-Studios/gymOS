import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

export function Features({ copy }: { copy: Copy }) {
  return (
    <section className="bg-white">
      <Container className="py-20 sm:py-24">
        <SectionHeading title={copy.features.title} subtitle={copy.features.subtitle} />
        <div className="mt-14 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((item) => (
            <article key={item.title} className="border-t border-ink/10 pt-5">
              <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink/60">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
