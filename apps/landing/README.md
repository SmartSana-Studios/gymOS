# @gymos/landing

The public marketing site at **https://gymosapps.com**. Sells GymOS to gym
owners; it is not part of the product. No Supabase client, no auth, no
database, no analytics — every route is static HTML.

| | |
|---|---|
| **Production** | `https://gymosapps.com` |
| **Dashboard (owners sign in here)** | `https://app.gymosapps.com` |
| **Super admin** | `https://portal.gymosapps.com` |
| **Local dev** | `pnpm --filter @gymos/landing dev` → port 3002 |

## Routes

| Path | What it does |
|---|---|
| `/` | Redirects (307) to `/en` or `/fr` from the visitor's `Accept-Language` — see `proxy.ts` |
| `/en`, `/fr` | The page, statically generated per locale |
| `/privacy` | Redirects (308) to `app.gymosapps.com/privacy` |

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

## Brand assets

Icons are generated from `brand/` at the repo root — see `brand/README.md`.
The landing page uses the **white** mark, matching super-admin; the dashboard
uses the blue one.
