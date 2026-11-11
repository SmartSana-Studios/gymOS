import { Button, Container, Eyebrow } from "./primitives";
import type { Copy } from "@/lib/copy";
import { contactChannel, HAS_WHATSAPP, SUPPORT_EMAIL } from "@/lib/config";

export function ClosingCta({ copy }: { copy: Copy }) {
  const contact = contactChannel(copy.cta.prefilledMessage);

  return (
    <section id="contact" className="on-navy bg-navy">
      <Container className="py-24 sm:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow onNavy>{copy.cta.eyebrow}</Eyebrow>
          <h2 className="mt-4 text-[2.25rem] font-extrabold leading-[1.04] tracking-[-0.03em] text-on-navy sm:text-6xl">
            {copy.cta.title}
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-on-navy-muted">{copy.cta.body}</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <Button href={contact.href} variant="primary" external withArrow>
              {HAS_WHATSAPP ? copy.cta.whatsapp : copy.cta.email}
            </Button>
            {/* Shown alongside WhatsApp, not instead of it: some owners will
                not start a WhatsApp conversation with a vendor they have
                never met, and the address is published in the policy anyway. */}
            {HAS_WHATSAPP ? (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-on-navy underline transition-colors hover:text-accent"
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
