# Adversarial review, V1.7 Step 2 (AD-42..AD-48, public landing-page site)

Scope: AD-42..AD-48 of ARCHITECTURE-SPINE.md, read against PRD 6.31 (FR-196..FR-208), NFR-024..026 and section 12 F. Spine not edited.

Method: for each AD, two compliant builders one level down (stories, or landing app vs dashboard vs DB), looking for incompatible builds or holes.

Verified on the web (2026-10-15):
- Next.js CSP guide: a nonce-based CSP requires dynamic rendering; "Static optimization and ISR are disabled", "Pages cannot be cached by CDNs without additional configuration". Hash/SRI mode is experimental. Without nonces the documented policy uses `'unsafe-inline'`.
- Vercel domains doc: wildcard certificates need DNS challenge access via Vercel nameservers **or** delegating only `_acme-challenge` by NS to `ns1/ns2.vercel-dns.com` while the existing DNS provider keeps everything else, including the wildcard CNAME to `cname.vercel-dns-0.com.` The doc also warns to copy MX and verification TXT before a nameserver change.
- Vercel limits: request body max 4.5 MB for Functions (413 FUNCTION_PAYLOAD_TOO_LARGE).
- Not verified (marked as such below): Supabase pooler custom-role login, Supabase Storage CDN delete latency, React 19 javascript: URL blocking, DNSSEC state of the A2 zone.

---

## Critical

None found. The highest items are high.

## High

### H1. AD-43: "wildcard certificate requires Vercel's nameservers" is false, and it forces the riskiest step (mail-bearing DNS move)
- AD: AD-43 rule, first sentence.
- Verified: Vercel documents an external-DNS path for wildcards: delegate only `_acme-challenge` to Vercel by two NS records and keep the zone, MX, SPF, DKIM at A2; add `* CNAME cname.vercel-dns-0.com.` there.
- Failure: the product owner decided "option A" on a false premise. Full nameserver cutover puts live mail (MX, SPF, DKIM, DMARC, cPanel webmail) at risk for a benefit (wildcard cert) obtainable without moving it. Any missed record, DS record left at the registrar (DNSSEC), a CAA record that excludes Let's Encrypt, or A2 plan cancellation inside the 14-day window becomes a mail outage. Note TTL lowering does not shorten NS delegation caching (registry NS TTL is typically 48 h), so "lower TTLs 24 h ahead" does not bound the cutover.
- Minimal change: state both options; make "keep A2 nameservers + `_acme-challenge` NS delegation + wildcard CNAME at A2" the default, and keep the full move only as an explicit later decision. If the full move stays, add to the gate: check and remove DS at the registrar before NS change, inventory and copy CAA (must permit letsencrypt.org), freeze zone edits at A2 from export until cutover completes, and run both zones identical for at least 72 h.

### H2. AD-44: the CSP as written cannot be built, and each way to make it work breaks a different AD
- AD: AD-44 CSP clause, AD-46 caching, NFR-025, FR-206 (`primary color`).
- Failure scenario: Story A (page shell) ships `default-src 'none'; style-src self; no inline script`. Next.js emits inline hydration/RSC scripts and nonce-able styles; nonce mode forces dynamic rendering, which disables ISR and CDN caching (verified), contradicting AD-46's tag-revalidation/CDN-purge model and NFR-025. Story B (theming) applies the gym's `primary color` through a `style` attribute or CSS variable; `style-src 'self'` blocks inline style attributes and nonces cannot cover attributes. Both stories quietly add `'unsafe-inline'` to pass, and the "strict CSP" is gone while the header test still passes because it checks presence, not content. The directive list is also incomplete: no `script-src`, `connect-src` (RSC navigation/prefetch), `font-src`, `form-action`, `base-uri`, `object-src`.
- Minimal change: pick one mechanism in the AD: static/ISR pages with experimental SRI hash CSP and **no** inline style attributes (gym color goes through a build-time-known palette of ~12 pre-generated classes or an external per-page stylesheet route `/theme.css`), or fully dynamic rendering with nonces and an explicit cache design (cache the data, not the HTML). Spell out the full directive list. The security-header test must assert exact policy string and fail on `'unsafe-inline'`/`'unsafe-eval'`. Add HSTS (`max-age`, `includeSubDomains`) to the header list.

### H3. AD-46 / AD-42: takedown and unpublish have no delivery guarantee; stale pages can persist indefinitely
- AD: AD-46 revalidation clause; AD-42 (landing holds no key).
- Failure: the DB is the only place that knows a page was taken down, but the landing app holds no Supabase client and exposes revalidation via an endpoint. Who calls it? A trigger can only reach it via `pg_net` or an edge function; if that call fails (deploy in progress, 5xx, secret rotated) nothing retries, and ISR/Data Cache has no expiry by default, so an illegal-content takedown (FR-204/FR-207, 60 s promise) stays live until the next edit. Suspension is worse: gym status is changed from several paths (billing job, Super Admin, the revert trigger noted in memory) and AD-46 says each "call on-demand revalidation", i.e. N call sites, not one.
- Minimal change: (1) every public response also carries a time-based TTL backstop (`revalidate` and `s-maxage` <= 60 s for the page, <= 300 s CDN) so correctness never depends on the push; (2) revalidation requests go through one outbox table written by a single trigger on `gym_pages` and on `gyms.status` and drained by its own `job_runs` cron with retry; (3) the revalidate endpoint verifies an HMAC secret and is rate-limited.

### H4. AD-42 + AD-46: the pinned column list protects nothing because the payload is one `jsonb` column
- AD: AD-42 "column list is the FR-206 field list pinned by snapshot test"; AD-46 `content jsonb`.
- Failure: the view exposes `content` as an opaque blob. Story X (publish function) validates with Zod but stores the original object, or Zod is non-strict; Story Y adds `plan_id` or `gym_id` or a member count to the plan array "for the booking link". The column snapshot test passes (still the same columns), NFR-024's "cannot expose an unpublished field" is violated, and FR-206's "no internal identifiers" with it.
- Minimal change: `PageContentV1` is `.strict()` and the function stores the **parsed output**, never the input; a DB CHECK or a test walks the jsonb key set against an allowlist generated from the schema; the snapshot test pins the JSON key paths, not just the columns; plans in the snapshot carry no ids (a position index only).

### H5. AD-42 fallback: "PostgREST with a signed role claim" gives the public app a service-role forging secret
- AD: AD-42 Fallback sentence.
- Failure: PostgREST accepts any JWT signed with the project's JWT secret (or signing key) and honours its `role` claim. For the landing app to "sign a role claim" it must hold that secret, which can equally sign `role: service_role`. This is exactly what NFR-024 ("no privileged database credential") and the AD's own Prevents line forbid, and nothing flags it as a violation because the key is not named "service role".
- Minimal change: the fallback is a **pre-minted, long-lived, role-limited JWT** (role `public_site_reader`), minted once offline; the signing secret never enters any app env; or an edge function exposing only the views. Add "no JWT secret or signing key in the landing app" to the NFR-024 test.

### H6. AD-43: reserved names are not tied to what DNS actually contains; wildcard silently hijacks or is hijacked
- AD: AD-43 "reserved list ... one source" (proxy and `page_names`), FR-202 list.
- Failure: the reserved list is a hand-seeded word list; the DNS zone is a separate source. FR-202 omits many labels that exist or will exist at A2/Vercel: `ftp`, `smtp`, `imap`, `pop`, `webmail`, `cpanel`, `autodiscover`, `autoconfig`, `ns1`, `ns2`, `whm`, `_dmarc`-style hosts. Because the wildcard answers everything without an explicit record, a gym can claim `autodiscover` (mail clients send credentials to `autodiscover.<domain>` over HTTPS) or `webmail` and receive traffic or serve a convincing credential-harvest page on a genuine-looking host. Reverse: ops later adds an explicit `status.` or `docs.` record; if a gym had claimed that name, the explicit record silently shadows its live page; no check exists.
- Minimal change: the build-time reserved list is the union of (a) the FR-202 list, (b) every label in the exported DNS zone (CI diff against Vercel/A2 export), and (c) a fixed mail/infra label set. Adding any DNS record requires the reserved-table row in the same change. Add a periodic check that every active `page_names` row does not equal an explicit DNS label.

### H7. AD-46 + AD-45: the public report path has no write route
- AD: AD-42 ("no other privilege on any relation or function"), AD-46 (`page_reports` "no read path from the public role"), FR-204 (visitor report form).
- Failure: `public_site_reader` is SELECT-only on views by test; `apps/landing` has no client and no key. So the report form's insert has no compliant implementation. Story builder picks a grant of INSERT on `page_reports` to the reader role (test is told "fails on any addition", gets edited), or routes through `anon` with a permissive RPC, or an unauthenticated edge function with no abuse control. A takedown-and-appeal workflow driven by unauthenticated submissions is also a harassment vector (a competitor floods reports against a gym).
- Minimal change: name the write path: a single `SECURITY DEFINER` function `submit_page_report(page, reason, contact?)` executable by `public_site_reader` only (documented exception in the grants test), taking no table privilege, with per-IP and per-page rate limits and a captcha/proof, dedupe, and reports never auto-unpublish.

### H8. AD-43: random-label flood turns the wildcard into a database DoS on the shared Supabase project
- AD: AD-43 (any valid-grammar label goes to the DB), AD-42 (pooler).
- Failure: `a1b2c3.gymosapps.com` ... any unclaimed valid label passes the grammar check, misses CDN (cache key includes host) and runs a pooler query. An attacker with a few hundred requests per second exhausts pooler connections shared with the core product (member check-ins, payments). Same-response rule (FR-207) also requires identical status, headers and body for unknown vs taken-down vs suspended names, including `Cache-Control`.
- Minimal change: negative caching (not-found cached 30-60 s at the edge, keyed by host, with the same headers as takedown), per-IP rate limit in the proxy, a bounded in-process set of known active names refreshed every <= 60 s to short-circuit unknown labels, and a dedicated low `CONNECTION LIMIT`/`statement_timeout` on `public_site_reader`.

## Medium

### M1. AD-42: "views built on gym_pages and nothing else" contradicts the visibility predicate
- AD-46 defines visible as published AND not taken down AND name `active` AND gym status `active`. `page_names` and `gyms` are joined, so the rule is false as written. A builder who obeys "nothing else" denormalizes `name` and `gym_status` into `gym_pages`, creating a second writer of gym status (stale after suspension). Fix: state the view joins `page_names` and `gyms` under owner rights; one base view `public_site.visible_pages` holds the predicate and every other view (sitemap, directory) selects from it; a test asserts no other view references `gym_pages` directly.

### M2. AD-42: PUBLIC default EXECUTE bypasses the "no function privilege" test as written
- Functions created by postgres in `public` carry default EXECUTE to PUBLIC, which `public_site_reader` inherits, including SECURITY DEFINER RPCs (this is the repo's own Epic 18 trap). Grants enumerated through `information_schema` per role will not show it as a grant to the role. Fix: test with `has_function_privilege` / `has_table_privilege` over every `pg_proc` and `pg_class` for the role, `REVOKE ALL ON SCHEMA public FROM public_site_reader`, `REVOKE CONNECT` from PUBLIC if feasible, and set `search_path` on the role.

### M3. AD-46: snapshot divergence can leak what the Owner just made private
- FR-200 makes plans private by default. If an Owner flips a plan to private, deletes it, or changes the public contact after publishing, the snapshot keeps exposing the old value until someone republishes. The gate trigger only unpublishes when the gate fails; "source columns" is not enumerated, so a later story adds a field (e.g. hours table) without trigger registration. Fix: either mark the page `stale` with a visible Owner banner and auto-republish for removal/privacy-reducing edits (private plan, contact change, address) while additions wait for explicit publish; enumerate trigger sources from a generated inventory like AD-39's; lock the gym row in `publish_gym_page` against the trigger.

### M4. AD-45 / AD-43: redirects have no public read path and leak state
- `page_names.state = redirect` is served by the landing app, but AD-42 allows only views over `gym_pages`; the predicate "name active" excludes redirects. A builder adds a grant on `page_names` (breaks AD-42) or omits redirects (breaks FR-203). Also, a redirect for a taken-down or suspended gym reveals the current name and its existence, contradicting FR-207 "same not-found". Fix: a `public_site.redirects` view, which returns rows only when the target is visible; takedown and force-rename drop redirects; cache <= 5 min.

### M5. AD-45: collision checks are not atomic and the fold is not an index
- Uniqueness is on `lower(name)`; homoglyph/distance-1 checks live only in `claim_page_name()`. Two concurrent claims `gymfit` and `gymf1t` each pass the near-match check and both insert. The reserved-list trigger refuses only matches of the list at that moment; new brand words added later never rescan active names. Fix: store a `folded_name` column with a unique index and an advisory lock per fold bucket in the function; Super Admin word-list edits enqueue a rescan that puts offending active names on hold. Also name an expiry job (reserved -> released after 12 months, redirect -> released): none exists in AD-19 terms.

### M6. AD-47: draft images are public before publish, and unpublish destroys what republish needs
- Uploads go into a public bucket at edit time (before the FR-199 gate), so unpublished content is world-readable by key. "Unpublish removes the object" conflicts with "unpublishing is always allowed" and republish (the snapshot then points at deleted keys), and destroys evidence needed for a takedown/appeal on illegal content. Fix: upload to a private staging prefix; copy to the public bucket at publish (as the logo already is); on unpublish remove public copies and keep staging; on takedown retain evidence privately for a defined period.

### M7. AD-47: upload route cannot be both "server function only" and reachable, and sizes break at 4.5 MB
- Vercel Function request bodies cap at 4.5 MB (verified); phone photos routinely exceed that and the mobile app is not a Next.js client. A story solves it with a signed direct-to-Storage upload, bypassing re-encode and metadata strip. Fix: define the path: signed upload to the **private staging** prefix, then a server function that downloads, re-encodes (`limitInputPixels` set low, reject animated, sniff magic bytes not Content-Type) and writes the public copy; bucket `allowed_mime_types` and no client INSERT policy on the public bucket. Storage CDN staleness after delete is unverified; state the assumed purge time and test it.

### M8. AD-48: gym-supplied URLs and phone numbers are unconstrained
- Public contact, WhatsApp, "directions", website/social, and JSON-LD `url`/`sameAs`/`telephone` are strings in `PageContentV1`. JSON-LD escaping of `<>&` is right but does not stop `javascript:`/`data:` hrefs or open-redirect style links. Fix: the schema accepts E.164 phones only and builds `tel:` / `https://wa.me/<digits>` / maps links from structured fields in the template; any URL field is `https` with an allowlisted host or absent; one link-builder function.

### M9. AD-43: Host parsing under-specified
- "First label of Host" accepts `a.b.gymosapps.com`, `NAME.gymosapps.com.` (trailing dot), uppercase, ports, and any `*.vercel.app` alias of the project (first label may be a valid name). Duplicate-content pages and cache keys follow. Also AD-43 sends reserved labels (`www`) to the same not-found response while `apps/landing` is the `www.` project (section 12 F), so a compliant proxy would 404 the marketing site. Fix: require exact match `^[a-z0-9-]{3,30}\.gymosapps\.com$` after lowercasing and trailing-dot strip; reject anything else before any lookup; define the apex/`www` behaviour explicitly (served by a separate route group, not by the tenant route); and the tenant route re-derives the name from the validated host itself rather than trusting an `x-tenant-*` header (proxy/middleware bypass has precedent: CVE-2025-29927).

### M10. AD-44: cookie rule covers two apps, but NFR-026 names three hosts, and migration is silent
- AD-44 binds "dashboard and super-admin" while NFR-026 and AD-43 name `portal.` as well; the member portal's cookies are not bound. The `__Host-` rewrite also leaves pre-existing unprefixed `sb-*` cookies: the old name remains tossable and, if either app still falls back to reading it, the prefix bought nothing. Also, `HttpOnly` "where the client allows" is vacuous: the Supabase browser client reads cookies from JS, so XSS on the staff apps (not the landing app) still exfiltrates the session; the real protection is that sibling hosts cannot run script, which depends entirely on H2. Fix: list every app under every host in the rule, stop reading legacy cookie names after a one-time re-login, and add the same test to `portal.`.

### M11. AD-46: support-published content changes have no Owner visibility
- Support (and Supervisors) can edit public contact and publish. A compromised support account swaps the gym's public phone/WhatsApp for a scammer's number; AD-40 step-up covers payment-connection, refunds, staff creation only. Fix: any change to public contact, address or name by a non-Owner is notified to the Owner (AD-25) and listed in the AD-41 digest; consider step-up for contact changes by support.

### M12. AD-43: dangling DNS and third-party records
- Explicit CNAMEs to Vercel for `owner.`, `portal.`, `www.` are takeover-prone if a Vercel project or domain assignment is removed or renamed (the repo's memory records DNS-on-rename as a trap), and A2 shared-hosting A records dangle after plan cancellation. Vercel requires TXT verification only when the domain sits in another account, which does not apply once the zone is yours. Fix: DNS inventory in `docs/` plus a periodic job that resolves every record target; deleting a Vercel project/domain assignment requires removing the record first.

## Low

- L1. AD-45: "a taken-down name is never released" but `taken_down_at` exists on both `gym_pages` and `page_names` with no stated owner; one column should be the writer, the other derived.
- L2. AD-46: snapshots of unpublished/taken-down pages retain public contact data indefinitely; purge `content` after a retention period.
- L3. AD-47: media origin is the Supabase project domain, which also serves `/rest/v1` and `/auth/v1`; add a rule that images are never served from a custom subdomain of `gymosapps.com` (would void the cookieless/different-domain claim) and keep `img-src` to the exact path prefix host.
- L4. AD-48: Unicode bidi/homoglyph in gym name/about enables visual impersonation; text-only rendering does not stop it. Normalize and strip bidi controls at validation.
- L5. AD-45: name squatting cost is the cost of creating a gym; confirm gym creation is Super Admin gated, otherwise one-name-per-gym is no limit.
- L6. AD-44: noindex/`X-Robots-Tag` and `Cache-Control: private` not specified for the 404 variants; set explicitly so edge caches never keep a "page exists" response.
