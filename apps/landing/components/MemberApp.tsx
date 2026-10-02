import Image from "next/image";
import { Container, Eyebrow } from "./primitives";
import type { Copy } from "@/lib/copy";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/config";

/** Store buttons are drawn from text plus each platform's glyph rather than
 *  Apple's and Google's official badge images: both badges are
 *  trademark-licensed assets with their own clear-space and wordmark rules,
 *  and a self-drawn lookalike that breaks them is worse than a plain,
 *  obviously-not-a-badge button. Swap for the real badge SVGs if and when
 *  they are downloaded from each programme's brand page. */
function StoreLink({
  href,
  label,
  glyph,
}: {
  href: string;
  label: string;
  glyph: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-3 rounded-2xl border border-line bg-card/70 px-5 py-3.5 text-sm font-semibold text-body transition-all duration-300 ease-smooth hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="text-accent">{glyph}</span>
      {label}
    </a>
  );
}

export function MemberApp({ copy }: { copy: Copy }) {
  return (
    <section id="app" className="relative">
      <Container className="grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        {/* A phone-shaped frame rather than another copy of the logo mark:
            the point of this band is "your members get an app", and a device
            silhouette says that faster. Drawn in CSS rather than shipped as
            a screenshot so it cannot go stale when the app's UI changes. */}
        <div className="reveal relative mx-auto w-full max-w-[15rem]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[-12%] rounded-full bg-accent/15 blur-3xl"
          />
          <div className="relative aspect-[9/19] rounded-[2.5rem] border border-line bg-card/80 p-2.5 shadow-card backdrop-blur-xl">
            <div className="flex h-full w-full flex-col items-center justify-center gap-6 rounded-[2rem] bg-gradient-to-b from-card2 to-bg2">
              <Image
                src="/gymos-icon-white.webp"
                alt="GymOS"
                width={160}
                height={160}
                className="h-auto w-24 rounded-2xl"
              />
              <span aria-hidden className="h-1 w-10 rounded-full bg-white/15" />
            </div>
          </div>
        </div>

        <div className="reveal">
          <Eyebrow>{copy.app.eyebrow}</Eyebrow>
          <h2 className="mt-5 text-balance text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">
            {copy.app.title}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted">{copy.app.body}</p>

          <div className="mt-9 flex flex-wrap gap-4">
            <StoreLink
              href={APP_STORE_URL}
              label={copy.app.appStore}
              glyph={
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5">
                  <path d="M16.3 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.1-1.5 2.7-.4 6.6 1.1 8.8.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7s1.6.7 2.8.7c1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.4zM14.2 5.9c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z" />
                </svg>
              }
            />
            <StoreLink
              href={PLAY_STORE_URL}
              label={copy.app.playStore}
              glyph={
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5">
                  <path d="M3.6 1.8c-.3.3-.5.8-.5 1.4v17.6c0 .6.2 1.1.5 1.4l.1.1 9.9-9.9v-.2L3.6 1.8zM17 15.3l-3.3-3.3v-.2L17 8.5l.1.1 3.9 2.2c1.1.6 1.1 1.7 0 2.3L17 15.3zM16.9 15.4L13.5 12 3.6 21.9c.4.4 1 .4 1.7.1l11.6-6.6M16.9 8.6L5.3 2c-.7-.4-1.3-.3-1.7.1L13.5 12l3.4-3.4z" />
                </svg>
              }
            />
          </div>

          <p className="mt-6 text-sm text-faint">{copy.app.note}</p>
        </div>
      </Container>
    </section>
  );
}
