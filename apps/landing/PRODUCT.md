# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent gym owners across Africa, English or French speaking, on a phone. They run the gym day to day, talk to GymOS on WhatsApp (or email) before deciding, and are the people who must act on this site. A second audience, gym-goers looking for a gym near them, arrives through the public directory of published gyms (Epic 25); the owner remains the primary visitor of the home page.

## Product Purpose

GymOS is gym management software: QR code check-in, membership and payment tracking, classes, workout plans, and a member app on Android and iPhone, in English and French. The main site sells GymOS to gym owners and, from Epic 25, also hosts the country and city directory of published gyms. Success on the home page is an owner starting a conversation (WhatsApp or email) or joining the founding-gyms list.

## Positioning

Confirmed by the product owner (2026-11-11), all four together:

- Built for African gyms.
- QR check-in with no paper register.
- Works with unreliable connectivity.
- Owners deal with the people who build it, and founding gyms shape what is built next.

## Capabilities and Constraints

- The marketing site is static: no Supabase client, no auth, no database, no analytics, no cookie. Every route is static HTML per locale (`/en`, `/fr`).
- All copy lives in `lib/copy.ts` in both languages; a sentence typed into JSX is a lint error. `<html lang>` follows the locale route.
- Product claims are limited to what GymOS ships today. Nothing describes a feature that does not exist.
- Hosts: `www.gymosapps.com` (this site), `owner.gymosapps.com` (dashboard), `portal.gymosapps.com` (super admin), `{name}.gymosapps.com` (gym pages).
- The directory (Epic 25) lives on this site and, like all public pages, must work without script and without third-party requests.

## Brand Commitments

Binding, from the product owner (2026-11-11), for this rebrand:

- Keep the GymOS orange `#E0971F`.
- Keep the logo (`public/gymos-logo-full-white.webp`, `public/gymos-icon-*.webp`).
- Keep all copy and claims in `lib/copy.ts`, English and French, as written; presentation changes only.
- Keep the section order and content of the home page.

Visual direction (product owner, 2026-11-11, from the direction round): the owner took the category standard, a clean modern SaaS landing played straight, rather than the dealt creative world. The craft bar is the gym-software competitors owners will compare us against (Glofox, Mindbody, Wodify) and the African fintech sites their visitors already trust (Paystack, Flutterwave). Execute that at full fidelity, with no irony and no smuggled quirk; the dealt worlds (The Cahier, L'Enseigne Peinte, The Forge) were declined and stay out.

The current look was deliberately modelled on another site's (gym.smartsana.com) layout and palette (README, "Design"). The rebrand treats that look as the old world to replace, not polish.

## Evidence on Hand

- No customers, counts or testimonials exist yet, and none may be invented. The Testimonials section renders nothing until a real quote and permission exist.
- Imagery today is stock photography (Unsplash ids in `lib/images.ts`), used only as gym environments and training, never presented as a GymOS customer. The owner chose to keep stock imagery for now. No real product screenshots or pilot-gym photos are supplied for this pass.
- Product mock-ups inside the hero (check-in panel with sample names) read as product UI and are labelled as samples.

## Product Principles

- Honest before impressive: no claim, number or face the product cannot back.
- Mobile-first, on 4G: the owner's phone is the real viewport.
- Two languages are one product: English and French get equal craft.
- Africa is the home, not a market segment: nothing on the site reads as a foreign product localised.
- Fast to a conversation: the owner should reach WhatsApp from any point on the page.

## Accessibility & Inclusion

Honor `prefers-reduced-motion` (the existing site already does: complete, readable page with no animation). Text contrast at WCAG AA or better; tap targets at least 44 px; usable at 320 px and 400% zoom. French and English both complete.
