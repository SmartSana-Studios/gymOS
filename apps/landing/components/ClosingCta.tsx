import { Button, Container, Eyebrow } from "./primitives";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP, SUPPORT_EMAIL } from "@/lib/config";

export function ClosingCta({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);

  return (
    <section id="contact" className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.13] blur-[130px]"
      />
      <Container className="relative py-24 sm:py-28">
        <div className="reveal mx-auto max-w-2xl text-center">
          <Eyebrow>{copy.cta.eyebrow}</Eyebrow>
          <h2 className="mt-6 text-balance text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl">
            {copy.cta.title}
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-pretty leading-relaxed text-muted">
            {copy.cta.body}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button href={contact.href} variant="primary" external withArrow>
              {HAS_WHATSAPP ? copy.cta.whatsapp : copy.cta.email}
            </Button>
            {/* Shown alongside WhatsApp, not instead of it: some owners will
                not start a WhatsApp conversation with a vendor they have
                never met, and the address is published in the policy anyway. */}
            {HAS_WHATSAPP ? (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sm font-semibold text-muted underline underline-offset-4 transition-colors hover:text-accent"
              >
                {SUPPORT_EMAIL}
              </a>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}
