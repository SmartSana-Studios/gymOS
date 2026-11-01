# Epic 24 Context: Gym Landing Pages at {name}.gymosapps.com

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A gym can publish one optional public page at `{name}.gymosapps.com`, built from a swappable template over the gym's own content. Nothing is public until the Owner acts. The public site reads only a published projection through one hardened read-only role, never tenant tables, so a defect in it cannot expose a member, a payment or a staff identity. Existing gyms start with no page, no name and no public plan.

## Stories

- Story 24.0: Pre-Flight Checklist (Product Owner)
- Story 24.1: Spike: Pooler Role, DNS Precedence, `__Host-` Cookies, AutoSSL
- Story 24.2: Wildcard Delegation & Reserved-Label CI Check
- Story 24.3: Staff Session Cookies: `__Host-` Prefix, Host-Only
- Story 24.4: `public_site` Schema & Hardened Reader Role
- Story 24.5: Page Content Fields & Public Plans
- Story 24.6: Page Media: Private Originals, Re-Encoded Derivatives
- Story 24.7: Page Names: Claim, Hold, Rename, Redirect
- Story 24.8: Publish Gate, Snapshot & Unpublish
- Story 24.9: Landing-Page Editor & Publish Screen (Dashboard)
- Story 24.10: Public Page Route, Template Contract & Two Seed Templates
- Story 24.11: Takedown, Reports, Sitemap & Media Purge
- Story 24.12: Landing-Page Gate: Isolation, Headers & Speed Baseline

## Requirements & Constraints

- FR-196: one optional landing page per gym; no login, member counts or staff names on it; visitor can call, open WhatsApp or get directions.
- FR-197: page content fields (about, services, public plans and session plans with prices, address and map position, opening hours, public contact distinct from the Owner's login phone, gallery, banner, logo, existing primary color and category). The login phone is never written to page fields.
- FR-198: Owner, Supervisor or assigned support edit and publish; only the Owner (or Super Admin) claims or renames the name.
- FR-199: publish only when name, category, logo, banner, about of at least 100 characters, country and city, one public contact, opening hours and one public plan exist. The gate is re-evaluated on every change: a page that stops meeting it unpublishes itself and the Owner is told why.
- FR-200: plan visibility is opt-in per plan; private by default.
- FR-201: at least two templates under one contract and an automated conformance suite.
- FR-202/203: name grammar (3 to 30 chars, `a-z0-9-`, no leading/trailing hyphen, no `--`, no `xn--`, not digits only), unique case-insensitively, reserved list; first come first served; reserved to the gym while unpublished or suspended up to 12 months; at most two renames per rolling 12 months; old name redirects (301, one hop) for 12 months.
- FR-204: Super Admin takedown with reason code blocks republishing; public report form answered within 5 business days; Owner appeal path.
- FR-205: text only, no HTML or script from a gym reaches the page; images re-encoded with metadata stripped, bounded, served from a separate cookieless origin, purged on unpublish or delete.
- FR-206/NFR-024: public site reads a published projection with a pinned column list (snapshot test), as a role with no privilege on anything else.
- FR-207: an unpublished, taken-down or suspended page returns the same not-found response and leaves address, directory and sitemap within 60 s at the origin, CDN purge within 5 min, sitemap regenerated within 15 min (confirmed 2026-11-01).
- FR-208: page chrome in EN and FR. **Gym content may be entered in both languages, each optional (OQ-28, 2026-11-01).** Show the visitor's language when it exists, else the other; declare language alternates only where both exist.
- NFR-025: p75 LCP 3 s on mid-range Android over 4G, baseline measured in 24.12. NFR-026: security headers per AD-44.

## Technical Decisions

- AD-42: `public_site` schema of views only, one login role `public_site_reader` reached through the pooler from server code; `apps/landing` holds no Supabase client library, anon key, service-role key or JWT secret. Only exception: `submit_page_report()`.
- AD-43: tenant identity comes from the Host header alone. Nameservers stay at A2 Hosting; `NS _acme-challenge` is delegated to Vercel and `CNAME *` points at the `apps/landing` project. Explicit records for `owner.`, `portal.`, `www.`, the apex and mail stay unchanged.
- AD-44: staff auth cookies are host-only with the `__Host-` prefix; gym pages are static HTML with no client JavaScript and a strict content security policy.
- AD-45/46/48: page names are rows with one grammar and one reserved source; `gym_pages` holds the snapshot; templates follow one contract.
- 24.1 is a spike on four unverified assumptions (pooler role, DNS precedence, `__Host-` cookies, AutoSSL); fallbacks are already decided in AD-42 to AD-44 and trigger only if the spike says so.
- Migrations take the next free number at merge time. Last applied in production: 0159.
- 24.2 also moves `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` reads behind one host-neutral module per app.

## UX & Interaction Patterns

- No V1.7 UX spec exists. The `bmad-ux` pass runs after 24.8 and before 24.9 (decided 2026-11-01); 24.9 and 24.10 depend on it. Until then follow existing Settings patterns.
- The editor offers an EN and an FR field for about, services and public plan labels, each optional. A "what becomes public" screen precedes publishing.
- Bilingual EN/FR for all Owner-facing text.

## Cross-Story Dependencies

- 24.1 gates 24.2, 24.3, 24.4. 24.4 then 24.5, then 24.6 and 24.7 (24.7 also needs 24.2), then 24.8, then the UX pass, then 24.9 and 24.10 (24.10 also needs 24.3), then 24.11, then 24.12.
- Epic 25 (directory) starts after this epic's Step 2 gate; FR-211 structured data belongs to Epic 25.
- Support (Epic 23) is admitted to page content edits through the AD-35 registry; its edits to public contact or about text appear in the Owner's daily digest (FR-181).
