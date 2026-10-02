import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * Replaces the "Trusted by 500+ gyms" band that a template landing page puts
 * here. GymOS is onboarding its first gyms, so a customer count would be a
 * fabrication aimed at exactly the people being asked to trust it. The
 * founding-gym framing is the true version of the same message, and it is a
 * stronger one for an early product: it offers access and influence rather
 * than claiming a crowd.
 */
export function EarlyAccess({ copy }: { copy: Copy }) {
  return (
    <section className="border-b border-ink/10 bg-white">
      <Container className="py-14 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            {copy.earlyAccess.badge}
          </span>
          <h2 className="mt-5 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {copy.earlyAccess.title}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-ink/65">{copy.earlyAccess.body}</p>
        </div>
      </Container>
    </section>
  );
}
