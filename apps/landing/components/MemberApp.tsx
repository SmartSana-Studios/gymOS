import Image from "next/image";
import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/config";

/** Store buttons are built from text and brand colour rather than Apple's and
 *  Google's official badge images: both badges are trademark-licensed assets
 *  with their own clear-space and wordmark rules, and a self-drawn lookalike
 *  that breaks them is worse than a plain, obviously-not-a-badge button. Swap
 *  these for the real badge SVGs if and when they are downloaded from each
 *  programme's brand page. */
function StoreLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {label}
    </a>
  );
}

export function MemberApp({ copy }: { copy: Copy }) {
  return (
    <section id="app" className="bg-ink-deep text-white">
      <Container className="grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[0.9fr_1.1fr]">
        {/* A phone-shaped frame rather than the same square mark the hero
            already shows: the point of this band is "your members get an
            app", and a device silhouette says that faster than a second
            copy of the logo does. Drawn in CSS rather than shipped as a
            screenshot so it cannot go stale when the member app's UI
            changes. */}
        <div className="order-2 mx-auto w-full max-w-[14rem] lg:order-1 lg:max-w-[16rem]">
          <div className="aspect-[9/19] max-w-full rounded-[2.25rem] border border-white/15 bg-white/[0.06] p-2.5 shadow-2xl">
            <div className="flex h-full w-full flex-col items-center justify-center gap-5 rounded-[1.75rem] bg-ink">
              <Image
                src="/gymos-icon-white.webp"
                alt="GymOS"
                width={160}
                height={160}
                className="h-auto w-24 rounded-2xl"
              />
              <span aria-hidden className="h-1 w-10 rounded-full bg-white/20" />
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {copy.app.title}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-white/70">{copy.app.body}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <StoreLink href={APP_STORE_URL} label={copy.app.appStore} />
            <StoreLink href={PLAY_STORE_URL} label={copy.app.playStore} />
          </div>

          <p className="mt-5 text-sm text-white/50">{copy.app.note}</p>
        </div>
      </Container>
    </section>
  );
}
