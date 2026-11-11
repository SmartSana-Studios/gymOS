import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * Four product facts, not outcome claims: check-ins are recorded
 * automatically because that is what the scanner does, both apps are
 * published, the whole system is bilingual, and the paper register is the
 * thing being replaced. Each one is true by construction and checkable.
 *
 * An orange band, the first full-width colour field after the navy hero. All
 * text on it is navy (7.09:1).
 */
export function StatsStrip({ copy }: { copy: Copy }) {
  return (
    <section className="bg-accent">
      <Container className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {copy.stats.map((stat, index) => (
          <div
            key={stat.label}
            className={`flex items-baseline gap-5 py-7 lg:block lg:px-8 lg:py-12 ${
              index > 0 ? "border-t border-navy-deep/20 sm:[&:nth-child(2)]:border-t-0 lg:border-t-0" : ""
            } ${index > 0 ? "lg:border-l lg:border-navy-deep/20" : ""} ${index === 0 ? "lg:pl-0" : ""}`}
          >
            <div className="min-w-[4.5rem] shrink-0 font-display text-5xl font-extrabold tabular-nums tracking-[-0.03em] text-navy-deep lg:min-w-0 lg:text-6xl">
              {`${stat.value}${stat.suffix}`}
            </div>
            <p className="text-base font-medium leading-snug text-navy-deep lg:mt-3">{stat.label}</p>
          </div>
        ))}
      </Container>
    </section>
  );
}
