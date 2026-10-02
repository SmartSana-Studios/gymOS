/**
 * Every externally-owned value the landing page renders.
 *
 * All of these are NEXT_PUBLIC_-prefixed on purpose: a marketing page has no
 * server-side secrets, and each value ends up in an href the browser has to
 * be able to read. Nothing here is sensitive -- a WhatsApp number and a
 * support address are published *in order* to be read.
 *
 * Each has a real default rather than `undefined`, so the page renders
 * correctly from a bare checkout with no .env at all. The one exception is
 * the WhatsApp number, which has no honest default -- see below.
 */

/**
 * Sales/support WhatsApp number in E.164 *digits only*, no `+`, no spaces --
 * the shape wa.me requires (e.g. `237670000000`).
 *
 * Deliberately has NO default. A wrong number here is worse than no number:
 * it either dead-ends a prospect who was ready to talk, or worse, sends a
 * stranger's WhatsApp to somebody else's phone. When this is unset the
 * contact CTA falls back to the support email instead of rendering a
 * `wa.me/undefined` link -- see `contactChannel()` below.
 */
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/[^0-9]/g, "") ?? "";

/** Monitored inbox. Same address the privacy policy names as the
 *  data-deletion contact route (apps/dashboard/lib/legal/details.ts) -- if
 *  one changes, change both. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "hello@gymosapps.com";

/** Where a gym owner signs in. The dashboard's own custom domain, not this
 *  site's. */
export const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://owner.gymosapps.com";

/**
 * Public store listings for the member app. Both confirmed live 2026-10-02:
 * App Store "GymOS Member App" (released 2026-09-16), Play "GymOS".
 * Hardcoded defaults rather than required env vars because these are
 * immutable facts about published listings, not per-environment config.
 */
export const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL ?? "https://apps.apple.com/app/id6798403711";
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ??
  "https://play.google.com/store/apps/details?id=com.smartsana.gymos";

/**
 * Testimonial section kill switch, default OFF.
 *
 * The section is built and styled, but GymOS is onboarding its first gyms --
 * there are no real customer quotes yet, and inventing them on a page whose
 * entire audience is prospective customers is both a trust problem and, in
 * most markets, a regulated one. The flag exists so that the day a real gym
 * owner gives a usable quote, shipping it is editing `testimonials` in
 * lib/copy.ts and setting this to "true" -- not rebuilding a section.
 */
export const SHOW_TESTIMONIALS = process.env.NEXT_PUBLIC_SHOW_TESTIMONIALS === "true";

/**
 * The primary contact CTA's destination, resolved once so every call site
 * (hero, closing CTA, footer) agrees.
 *
 * WhatsApp is the intended channel -- it is how gym owners in this market
 * actually talk to vendors, and it is already how GymOS reaches owners and
 * staff. Email is the fallback for a deploy where the number has not been
 * set yet, which is a real state this repo passes through: the number was
 * still outstanding when this page was built.
 */
export function contactChannel(prefilledMessage: string): {
  href: string;
  kind: "whatsapp" | "email";
} {
  if (WHATSAPP_NUMBER) {
    return {
      href: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(prefilledMessage)}`,
      kind: "whatsapp",
    };
  }
  return {
    href: `mailto:${SUPPORT_EMAIL}?body=${encodeURIComponent(prefilledMessage)}`,
    kind: "email",
  };
}

/** `true` once a WhatsApp number is configured. Used to pick the CTA label,
 *  so the button never says "WhatsApp" while pointing at a mailto:. */
export const HAS_WHATSAPP = WHATSAPP_NUMBER.length > 0;

/** Public Facebook page. Hardcoded rather than env-driven for the same
 *  reason as the store links: it is a fact about a published page, not
 *  per-environment config. */
export const FACEBOOK_URL = process.env.NEXT_PUBLIC_FACEBOOK_URL ?? "https://www.facebook.com/gymosapp";

/**
 * GetSocial is the company behind GymOS -- the same entity the privacy
 * policy names as the operator ("GetSocial Inc", see
 * apps/dashboard/lib/legal/details.ts). The footer credit makes that
 * relationship visible, which also happens to be the thing
 * docs/privacy-policy.md's open item #1 flags as missing: a store reviewer
 * comparing the policy's entity name against the product's branding
 * currently finds no link between them anywhere public.
 */
export const GETSOCIAL_URL = process.env.NEXT_PUBLIC_GETSOCIAL_URL ?? "https://getsocial.digital";
