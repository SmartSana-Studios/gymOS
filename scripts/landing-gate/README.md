# Landing-page gate kit (Story 24.12)

Proof for the Step 2 release gate of Epic 24 (PRD 10.2; NFR-024, NFR-025, NFR-026). One kit, two places: **locally now** (`run-local.sh`), **on staging later** (the same scripts with `BASE_URL`). A result is always labelled where it was produced. A local result never signs the gate; see the checklist in `docs/decisions.md`, section "Story 24.12".

| Check | What it proves | Script |
|---|---|---|
| Isolation | `public_site_reader` and `anon` reach nothing outside the published projection (pgTAP) | `supabase/tests/public_site_reader_privileges.test.sql`, `supabase/tests/public_site_anon_isolation.test.sql` |
| Headers | real HTTP: the exact AD-44 set on a page, a not-found and a redirect; every hidden cause is byte-identical | `check-http.mjs` |
| Structured data (Story 25.4) | real HTTP: a gym page has exactly one `HealthClub` `application/ld+json` block and the Open Graph tags (`og:title` equal to the `<title>`); a city page has one `ItemList`; the top and country pages have the tags and no block; no response holds an executable `<script>` | `check-http.mjs` (`checkStructuredData` in `lib/headers.mjs`) |
| Crawler files (Story 25.5) | real HTTP on `www`: `robots.txt` allows everything and names the index; `/sitemap-index.xml` and each `/sitemaps/{n}.xml` are well formed, on the `www` origin, list no gym page or filtered view and carry en, fr and x-default alternates; EVERY listed URL is requested and answers 200 with no `noindex`; `/llms.txt` holds only allowlisted lines and none of the unpublished, taken-down, suspended or renamed fixture gyms; a chunk that does not exist is the uniform not-found; on a gym host `/llms.txt`, `/sitemap-index.xml`, `/sitemaps/1.xml`, `/en/gyms` and `/en/gyms/cm` (and `/robots.txt` of an unknown gym) are byte-identical to the unknown label's not-found. Shown failing on doctored sitemaps in `__tests__/headers.test.mjs` | `check-http.mjs` (kind `crawler` and `checkRobots`, `checkSitemapIndex`, `checkUrlset`, `checkListedPage`, `checkLlms` in `lib/headers.mjs`) |
| Directory (Story 25.3) | real HTTP on `www`: the top, country, city, filtered and unknown-place directory responses carry the AD-44 set, no `<script>`, no inline style attribute, no cookie, `s-maxage` at most 300, and one indexability signal (`X-Robots-Tag` and the robots meta tag agree; a filtered view is never `noindex`); the bare `/gyms/cm` is one 307 by `Accept-Language` | `check-http.mjs` (kind `directory` in `lib/headers.mjs`) |
| Speed | p75 LCP of a published page, lab conditions (CPU 4x, 1.6 Mbps, 150 ms RTT, 360x640, cold cache), 20 or more runs, EN and FR | `lcp.mjs` |
| Load | a label scan does not exceed the reader role's `CONNECTION LIMIT`, and the core product (dashboard Overview load, check-in RPC) stays inside its budget and within 25% of its own baseline | `load.mjs` |
| Purge job | the `page_media_purge` job ran successfully in the last 15 minutes | `purge-staleness.sql` (its regression test, `purge-staleness.test.sh`, runs in CI) |
| Page flows | claim, publish, rename, unpublish, takedown, uniform not-found, EN and FR | `apps/dashboard/e2e/landing-page-gate.spec.ts` (runs in `scripts/ci-local.sh --only e2e` and in CI) |

## Locally

```sh
bash scripts/landing-gate/run-local.sh            # check-http, lcp, load; summary at the end; exit 0 when http and load pass and lcp ran (the LCP baseline is recorded, not enforced: over target still exits 0; GATE_LCP_ENFORCE=1 makes it fail)
bash scripts/landing-gate/run-local.sh http       # one check (http | lcp | load)
bash scripts/landing-gate/run-local.sh serve      # fixtures + servers only, to look at a page: http://gate-grace.localhost:3200/
node --test scripts/landing-gate/__tests__/*.test.mjs   # the kit's own tests (also part of `pnpm run test:guardrails`)
```

Needs the local Supabase stack, Node 22 and Chromium (`cd apps/dashboard && npx playwright install chromium`). The script seeds throwaway gyms (published, unpublished, taken down, suspended, renamed; the published one also has a city, Garoua in Cameroon, so the directory pages list it) and one core-probe gym, starts a storage stand-in, the landing server and the dashboard, and **always** removes the fixtures again (a leftover published page breaks the reader privilege suite). All output lands in `$TMPDIR/landing-gate-results`.

Local numbers are a floor: the server, the database, the load and the probes share one machine.

## On staging (the owner runs this)

The kit never creates anything on staging. The owner sets aside:

- a **published** page (all ten sections, both languages: the shape of `fixtures/full-page.json`), a page with an **old name** that redirects (required: the headers of a redirect are part of the gate), an **unpublished** page, a **taken-down** page, optionally a suspended gym's page;
- one **probe gym** with an Owner (email login) and a member (phone login, active subscription) for the core probes;
- a database URL that can read `pg_stat_activity` and `pg_roles` (a `pg_monitor` member is enough) for the connection sampler.

```sh
export BASE_URL='https://{label}.<staging root>'        # {label} is replaced; or http://host:port to address by Host header
export ROOT_DOMAIN='<staging root>'                     # e.g. staging.gymosapps.com
export GATE_MEDIA_ORIGIN='https://<ref>.supabase.co'    # the PUBLIC_SITE_MEDIA_ORIGIN of the deployment under test
export GATE_PLATFORM=vercel                             # allow, and print, the headers Vercel adds in front of the app
export GATE_ENV_LABEL='lab, staging'
export GATE_PUBLISHED_MARKER="<gym name of the published page>"   # the body check; the default is the local fixture's name
export GATE_LABEL_PUBLISHED=... GATE_LABEL_REDIRECT_OLD=... GATE_LABEL_UNPUBLISHED=... GATE_LABEL_TAKEN_DOWN=...   # REQUIRED with a {label} BASE_URL: check-http fails without them
export GATE_LABEL_SUSPENDED=...                                                      # optional; with a {label} BASE_URL it is skipped unless set
node scripts/landing-gate/check-http.mjs
node scripts/landing-gate/lcp.mjs
GATE_ADMIN_DB_URL='postgresql://...'  GATE_CORE_API_URL=... GATE_CORE_ANON_KEY=... GATE_CORE_DASHBOARD_URL=... \
GATE_CORE_OWNER_EMAIL=... GATE_CORE_OWNER_PASSWORD=... GATE_CORE_MEMBER_PHONE=... GATE_CORE_MEMBER_PASSWORD=... \
  node scripts/landing-gate/load.mjs
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/landing-gate/purge-staleness.sql
```

The load check needs permission from the owner to run against staging: it sends several thousand requests of random labels. Keep `GATE_LOAD_STEPS` small on a first run (`GATE_LOAD_STEPS=2,8`).

## Variables

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://127.0.0.1:3200` | where requests go; `{label}` is replaced by the page label, otherwise the label goes in the `Host` header |
| `ROOT_DOMAIN` | `localhost` | the root the labels live under |
| `GATE_MEDIA_ORIGIN` | `http://127.0.0.1:3911` | the storage origin the CSP names |
| `GATE_PLATFORM`, `GATE_ALLOWED_EXTRA_HEADERS` | `none`, empty | headers added by the platform; they are allowed and **printed**, never silent |
| `GATE_PUBLISHED_MARKER` | `GATE FIT` | text the published page must contain (its gym name); **set it to the staging page's gym name** |
| `GATE_DIRECTORY_COUNTRY`, `GATE_DIRECTORY_CITY`, `GATE_DIRECTORY_LABEL` | `cm`, `garoua`, `www` locally; empty on staging | the directory pages checked (country and city slugs that list the published page); with a `{label}` BASE_URL and these unset only the top pages are checked and the run says so |
| `GATE_LABEL_*` | the local fixture labels | `PUBLISHED`, `REDIRECT_OLD`, `UNPUBLISHED`, `TAKEN_DOWN`, `SUSPENDED`, `UNKNOWN`, `RESERVED`, `INVALID` |
| `GATE_LCP_RUNS`, `GATE_LCP_TARGET_MS`, `GATE_LCP_ENFORCE` | 20, 3000, off | the 3 s target stays an `[ASSUMPTION]`, so the default **records** the baseline; `GATE_LCP_ENFORCE=1` makes "over" fail |
| `GATE_LOAD_STEPS`, `GATE_LOAD_STEP_SECONDS`, `GATE_LOAD_REAL_SHARE`, `GATE_LOAD_SEED` | `2,8,24,64`, 15, 0.1, 1 | the scan; the same seed repeats the same labels |
| `GATE_ADMIN_DB_URL`, `GATE_READER_ROLE` | local postgres, `public_site_reader` | the sampler reads `pg_stat_activity` and the role's limit from `pg_roles` |
| `GATE_CORE_*` | set by `run-local.sh` | the core probes (see above); without them the load check fails: it cannot be claimed without the probes |
| `GATE_ENV_LABEL` | `lab, local` | printed with every result |

## What the headers check allows

The exact set per response kind is in `lib/headers.mjs` (`SECURITY_BASE`, `CACHE_CONTROL`, the CSP built independently from the media origin and the body's own style hash). Next.js adds its own `Vary: rsc, next-router-state-tree, ...` tokens and `x-middleware-rewrite: /gym-site` to a rewritten route; those are allowed and printed on every run, so a change shows. Any other header, or any missing one, fails and names the response kind and the header.
