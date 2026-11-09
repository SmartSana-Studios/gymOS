# @gymos/landing

The public marketing site at **https://gymosapps.com**. Sells GymOS to gym
owners; it is not part of the product. No Supabase client, no auth, no
database, no analytics — every route is static HTML.

| | |
|---|---|
| **Production** | `https://gymosapps.com` |
| **Dashboard (owners sign in here)** | `https://owner.gymosapps.com` |
| **Super admin** | `https://portal.gymosapps.com` |
| **Local dev** | `pnpm --filter @gymos/landing dev` → port 3002 |

## Routes

| Path | What it does |
|---|---|
| `/` | Redirects (307) to `/en` or `/fr` from the visitor's `Accept-Language` — see `proxy.ts` |
| `/en`, `/fr` | The page, statically generated per locale |
| `/privacy` | Redirects (308) to `owner.gymosapps.com/privacy` |

## Two things that are easy to get wrong

**All copy lives in `lib/copy.ts`, in both languages.** `i18next/no-literal-string`
is turned on specifically to make a sentence typed straight into JSX a lint
error, because the failure it prevents is silent: the page still builds, and
only a French reader ever sees the English text. If you need to render a
string built at runtime (a year, a joined label), build it as one JS
expression rather than as JSX text — see the footer's copyright line.

**`<html lang>` is why the root layout is at `app/[locale]/layout.tsx`** and
not at `app/layout.tsx`. A nested layout cannot change the `<html>` element,
so a single root layout would have served the entire French page as
`lang="en"`. Next supports a root layout nested under a dynamic segment; see
`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`.

## Configuration

See `.env.example`. Everything has a working default except
`NEXT_PUBLIC_WHATSAPP_NUMBER`:

- **While the number is unset**, the "Talk to us on WhatsApp" buttons point at
  `mailto:` the support address and relabel themselves "Email us". That is
  deliberate — a dead `wa.me/undefined` link on the one CTA the whole page
  drives toward is worse than an email. Set the number on the Vercel project
  to switch WhatsApp on; no code change needed.
- The number is sanitised to digits (`+237 6 70 00 00 00` → `237670000000`),
  so it can be pasted in whatever shape it is written down in.

## Testimonials

`components/Testimonials.tsx` is built, styled and **renders nothing**. It
needs both `NEXT_PUBLIC_SHOW_TESTIMONIALS=true` and a non-empty
`testimonials.items` in `lib/copy.ts`.

GymOS is onboarding its first gyms, so there are no real customer quotes yet,
and invented ones on a page whose entire audience is prospective customers
are a trust problem and a regulated one in most markets. The section a
template would fill with fake quotes is instead `components/Proof.tsx` — the
same three problems, written as problems GymOS solves rather than as words
put in a stranger's mouth.

When a real gym owner gives a usable quote: add it to `testimonials.items`
for **both** locales (keep a French quote in French — do not machine-translate
a person's words and leave their name under them), confirm you have their
permission to publish their name and gym, and flip the env var.

## Design

Modelled on `gym.smartsana.com` — its dark navy surface ramp, Sora/Inter
pairing, scroll reveals, counters and the hero's scanning-terminal
composition are all carried over. The one deliberate departure is colour:
the reference's green/cyan accent is replaced everywhere by the GymOS orange
(`#E0971F`), so the site matches the dashboard and the member app rather
than the site it was modelled on.

Palette tokens live in `tailwind.config.ts`, not in CSS variables — this app
has no theme toggle, so the indirection would buy nothing.

### Motion

`components/Motion.tsx` holds the only client-side JavaScript on the page:
an IntersectionObserver that adds `is-visible` to `.reveal` elements, and the
stat counters. Three things it deliberately does:

- **Honours `prefers-reduced-motion`.** Looping ornaments (the scanline, the
  floating chips, the live pulse) carry `motion-safe-only`, and the reveal
  classes resolve to fully visible. A visitor who has asked their OS to stop
  motion gets a complete, readable page, not a faster animation.
- **Reveals everything when `IntersectionObserver` is missing.** An
  unsupported browser must get a readable page, not a blank one.
- **Renders the final figure server-side.** Counters start at their real
  value, so a crawler, a JS-disabled visitor, or anyone who scrolls past
  before hydration sees the number rather than a stuck zero.

### Imagery

Gym photography is served from Unsplash's CDN (`lib/images.ts`), which is
licence-cleared for commercial use and is how the reference sources its own.
`next.config.ts` allow-lists that one host.

No photo is presented as a GymOS customer. The two faces on the page sit
inside the hero's mock check-in panel, which reads as product UI the way a
dashboard screenshot carries sample rows.

### What the reference claims that this page does not

The reference leads with "Trusted by 500+ gyms & studios", three named
customer testimonials, and a measured "0.8s avg. check-in time". None of
those is true of GymOS yet, so:

- the social-proof band is `components/EarlyAccess.tsx` — founding-gym
  framing, which is the true version of the same message;
- the testimonial band is `components/Proof.tsx` — the same three arguments
  written as problems GymOS solves, with no names attached;
- the stats strip is product facts that are true by construction (check-ins
  are automatic, both apps are published, the system is bilingual), not
  outcome percentages;
- the hero's second chip shows a mock scan count, not a performance claim.

## Brand assets

Icons are generated from `brand/` at the repo root — see `brand/README.md`.
The landing page uses the **white** mark, matching super-admin; the dashboard
uses the blue one.

## Gym pages (`{name}.gymosapps.com`, Story 24.10)

This app also serves the public pages of gyms. `proxy.ts` reads the first `Host` label under `PUBLIC_SITE_ROOT_DOMAIN`, answers the uniform not-found for names that can never be pages, and rewrites the rest to `app/gym-site/route.ts`, which reads one row from `public_site` as the read-only `public_site_reader` role, parses it with `PageContentV1` and renders a template from `@gymos/page-templates` as static HTML (no client JavaScript, no cookie, the AD-44 headers). The apex, `www.` and any host that is not under the root domain keep the marketing site.

Server environment (none of it is a Supabase key; `scripts/check-landing-no-supabase.mjs` guards that):

| Variable | Meaning |
|---|---|
| `PUBLIC_SITE_ROOT_DOMAIN` | `gymosapps.com`; `localhost` or `localhost:3002` in development (the default outside production). Unset in production turns gym hosting off. |
| `PUBLIC_SITE_MEDIA_ORIGIN` | the storage origin that serves page images (`img-src` of the CSP); unset makes every page the not-found |
| `PUBLIC_SITE_READER_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD` | the pooler connection as `public_site_reader` (user is `public_site_reader.<project_ref>`) |

Local try-out: `alter role public_site_reader password '...'` on the local database, set the variables (host `127.0.0.1`, port `54322`), run `next start`, then `curl -H "Host: some-name.gymosapps.com" http://127.0.0.1:3002/` with the root domain set to `gymosapps.com`.
