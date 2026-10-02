import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * Replaces the "Trusted by 500+ gyms & studios" band the reference runs
 * under its hero. GymOS is onboarding its first gyms, so a customer count
 * would be a fabrication aimed at exactly the people being asked to trust
 * it. The founding-gym framing is the true version of the same message, and
 * a stronger one for an early product: it offers access and influence rather
 * than claiming a crowd.
 */
export function EarlyAccess({ copy }: { copy: Copy }) {
  return (
    <section className="relative">
      <Container className="py-16 sm:py-20">
        <div className="reveal mx-auto max-w-3xl rounded-[1.75rem] border border-line bg-card/50 p-8 text-center backdrop-blur-sm sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            <span aria-hidden className="motion-safe-only h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
            {copy.earlyAccess.badge}
          </span>
          <h2 className="mt-6 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {copy.earlyAccess.title}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted">{copy.earlyAccess.body}</p>
        </div>
      </Container>
    </section>
  );
}
