import { Container, SectionHeading } from "./primitives";
import type { Copy } from "@/lib/copy";

/** One line-art glyph per feature, in dictionary order. Inline SVG rather
 *  than an icon package: nine paths weigh less than a dependency, and this
 *  page ships no client JS it does not need. */
const ICONS = [
  "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  "M1 4h22v16H1zM1 10h22",
  "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  "M6.5 6.5h11M6.5 6.5v11M17.5 6.5v11M2 9v6M22 9v6",
  "M12 2l3 7h7l-5.5 4.5L18.5 21 12 17l-6.5 4 2-7.5L2 9h7z",
  "M3 17l6-6 4 4 8-8M21 7v5h-5",
  "M12 2l9 4.5v5c0 5-3.8 9.3-9 10.5-5.2-1.2-9-5.5-9-10.5v-5z",
  "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-4-1L3 20l1.1-4.6a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 11.5 3h.5a8.4 8.4 0 0 1 9 8z",
];

export function Features({ copy }: { copy: Copy }) {
  return (
    <section className="relative border-y border-line bg-surface/40">
      <Container className="py-20 sm:py-24">
        <div className="reveal">
          <SectionHeading
            eyebrow={copy.features.eyebrow}
            title={copy.features.title}
            accent={copy.features.titleAccent}
            subtitle={copy.features.subtitle}
          />
        </div>

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((item, index) => (
            <article
              key={item.title}
              className="reveal group rounded-2xl border border-line bg-card/50 p-7 transition-all duration-500 ease-smooth hover:-translate-y-1 hover:border-accent/35 hover:bg-card"
              style={{ transitionDelay: `${(index % 3) * 100}ms` }}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent transition-colors duration-500 group-hover:bg-accent/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="h-5 w-5"
                >
                  <path d={ICONS[index] ?? ICONS[0]} />
                </svg>
              </span>
              <h3 className="mt-5 text-base font-bold tracking-tight">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
