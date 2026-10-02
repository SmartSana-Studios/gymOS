import { Container } from "./primitives";
import { Counter } from "./Motion";
import type { Copy } from "@/lib/copy";

/**
 * The reference puts percentage improvement claims here ("40% faster
 * check-ins"). Those are outcome claims about customers GymOS does not have
 * yet, so these four are product facts instead -- each one is true by
 * construction and checkable: check-ins are recorded automatically because
 * that is what the scanner does, both apps are published, the whole system
 * is bilingual, and the paper register is the thing being replaced.
 */
export function StatsStrip({ copy }: { copy: Copy }) {
  return (
    <section className="border-y border-line bg-surface/60">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {copy.stats.map((stat, index) => (
          <div key={stat.label} className={`reveal reveal-d${index}`} style={{ transitionDelay: `${index * 90}ms` }}>
            <div className="bg-gradient-to-br from-accent to-accent-soft bg-clip-text font-display text-4xl font-extrabold text-transparent sm:text-5xl">
              <Counter value={stat.value} suffix={stat.suffix} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{stat.label}</p>
          </div>
        ))}
      </Container>
    </section>
  );
}
