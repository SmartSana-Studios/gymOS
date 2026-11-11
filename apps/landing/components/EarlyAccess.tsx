import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";

/**
 * Replaces a "Trusted by N gyms" band. GymOS is onboarding its first gyms,
 * so a customer count would be a fabrication aimed at exactly the people
 * being asked to trust it. The founding-gym framing is the true version of
 * the same message: it offers access and influence rather than claiming a
 * crowd.
 */
export function EarlyAccess({ copy }: { copy: Copy }) {
  return (
    <section>
      <Container className="py-16 sm:py-24">
        <div className="grid gap-8 rounded-2xl bg-surface p-8 shadow-card sm:p-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16 lg:p-16">
          <div>
            <span className="inline-flex items-center rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-navy-deep">
              {copy.earlyAccess.badge}
            </span>
            <h2 className="mt-6 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] sm:text-4xl">
              {copy.earlyAccess.title}
            </h2>
          </div>
          <p className="max-w-[34rem] text-lg leading-relaxed text-body">{copy.earlyAccess.body}</p>
        </div>
      </Container>
    </section>
  );
}
