import Image from "next/image";
import { Container } from "./primitives";
import type { Copy } from "@/lib/copy";
import {
  APP_STORE_URL,
  DASHBOARD_URL,
  FACEBOOK_URL,
  GETSOCIAL_URL,
  PLAY_STORE_URL,
  SUPPORT_EMAIL,
} from "@/lib/config";

export function SiteFooter({ copy }: { copy: Copy }) {
  return (
    <footer className="bg-ink-deep text-white">
      <Container className="grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2.5">
            <Image
              src="/gymos-icon-white.webp"
              alt="GymOS"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-lg font-semibold tracking-tight">GymOS</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
            {copy.footer.tagline}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
            {copy.footer.product}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-white/65">
            <li>
              <a href={`${DASHBOARD_URL}/auth/login`} className="hover:text-white">
                {copy.footer.ownerLogin}
              </a>
            </li>
            <li>
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                {copy.app.appStore}
              </a>
            </li>
            <li>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                {copy.app.playStore}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
            {copy.footer.contact}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-white/65">
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-white">
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                {copy.footer.facebook}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
            {copy.footer.company}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-white/65">
            <li>
              {/* Served by apps/dashboard, which is where the policy text and
                  its operator details live -- and the URL registered in both
                  store consoles. Linking the canonical one keeps a single
                  policy rather than a second copy that drifts. */}
              <a
                href={`${DASHBOARD_URL}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                {copy.footer.privacy}
              </a>
            </li>
            <li>
              <a
                href={GETSOCIAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                {copy.footer.poweredBy}
              </a>
            </li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="py-6 text-center text-xs text-white/40">
          {/* Assembled as one expression rather than as JSX text, so that
              `i18next/no-literal-string` keeps seeing every visible word on
              this page as coming from the dictionary -- the rule is the only
              thing standing between this app and an untranslated sentence
              shipping to the French page.

              Copyright only: Facebook and the GetSocial credit are both
              already linked in the columns above, and repeating either one
              here reads as filler rather than as a second affordance. */}
          <span>{`© ${new Date().getFullYear()} GymOS. ${copy.footer.rights}`}</span>
        </Container>
      </div>
    </footer>
  );
}
