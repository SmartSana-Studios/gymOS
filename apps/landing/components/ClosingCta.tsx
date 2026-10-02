import { Button, Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP, SUPPORT_EMAIL } from "@/lib/config";

export function ClosingCta({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);

  return (
    <section id="contact" className="bg-accent">
      <Container className="py-20 text-center sm:py-24">
        <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {copy.cta.title}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-pretty leading-relaxed text-ink/75">
          {copy.cta.body}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button
            href={contact.href}
            external
            className="bg-ink text-white hover:bg-ink-soft focus-visible:outline-ink"
          >
            {HAS_WHATSAPP ? copy.cta.whatsapp : copy.cta.email}
          </Button>
          {/* Shown alongside WhatsApp, not instead of it: some owners will
              not start a WhatsApp conversation with a vendor they have never
              met, and the email is published anyway in the privacy policy. */}
          {HAS_WHATSAPP ? (
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-sm font-semibold text-ink/70 underline underline-offset-4 transition-colors hover:text-ink"
            >
              {SUPPORT_EMAIL}
            </a>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
