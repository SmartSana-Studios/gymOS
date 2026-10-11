# Version/Vendor Claim Re-Verification — ARCHITECTURE-SPINE.md (v1.6), 2026-10-11

Scope: Stack table (spine lines ~240-252) and AD-15 (lines 113-117). Supersedes the Stack-table parts of `review-version-verification.md` (2026-08-11). Sources: repo package.json files + pnpm-lock.yaml (resolved versions), `npm view` registry data (2026-10-11), Supabase docs fetched 2026-10-11.

## Verdict

Stack table is mostly stale on patch/minor numbers (every pinned version has moved) but nothing is wrong in kind. The one claim that is materially wrong/unconfirmed is Supabase Vault status ("beta"): Supabase's own features page currently labels it **Public Alpha**, while the vault GitHub README says "Beta". Never GA. pgsodium claim is right but understated.

## Table

| Item | Spine says | Repo pins (specifier -> resolved in lock) | Latest stable (npm, 2026-10-11) | Status |
|---|---|---|---|---|
| Next.js | 16.3.0, "repo pins latest" | `"latest"` in dashboard, super-admin, landing -> **16.3.8** | **16.4.0** (published 2026-10-06; 16.3.0 was 2026-08-03; 16.3.8 2026-09-30) | STALE. "latest" claim still true but lockfile is 16.3.8, spine number 16.3.0 matches neither lock nor registry. Floating `latest` is also a reproducibility risk (lock is the only pin). |
| Expo SDK | 57.0.7 | mobile: `expo ~57.0.20` -> **57.0.20**; expo-router ~57.0.19 | **57.0.27** (dist-tag latest; SDK 58 only at `next`/canary) | STALE patch (57.0.7 vs 57.0.20 pinned vs 57.0.27). Major SDK claim correct. |
| React Native | 0.86 | `react-native 0.86.3` exact | 0.87.1 | Correct for SDK 57 (0.86.x). Note 0.87 exists but is not what SDK 57 targets; do not treat as stale. |
| React | 19.2 | mobile: exact 19.2.3; dashboard resolves 19.2.7; super-admin/landing resolve 19.2.3 (`^19.0.0`) | 19.3.0 | Claim "19.2" OK for mobile. Repo is split across 19.2.3 and 19.2.7 for the Next apps (not a spine error, but worth noting). 19.3.0 is out; spine ties React to SDK 57 so no change needed unless SDK/Next bump pulls it. |
| Turborepo | 2.x (2.10.x) | root devDep `^2.10.3` -> **2.10.3** | **2.11.7** (2.11.0 released 2026-09-18) | "2.x" correct; "2.10.x" is stale (2.11.x current). |
| pnpm | (unversioned) | `packageManager pnpm@10.27.0`, node >=22 | not checked | Prior review claimed "pnpm past v11 as of July 2026" - repo is on 10.27.0, unconfirmed whether that is behind. Not in spine's version claims. |
| Supabase Vault | "confirm GA/beta; docs carried beta language; pgsodium pending deprecation in its favor" | in use: `supabase_vault` 0.3.1 locally (decisions.md 2026-08-17), migrations 0052/0054/0083 | n/a | See below. WRONG/unconfirmed: status is not GA. |
| TanStack Query | no version | dashboard only: `latest` -> **5.104.1** (not in mobile or super-admin) | 5.104.1 | Current. Spine's "dashboards" wording is slightly loose: only gym dashboard uses it, not super-admin. Floating `latest` specifier. |
| Zod | no version | packages/types `^4.4.3` -> **4.4.3** (a transitive zod 3.25.76 also in lock) | 4.6.5 | Spine has no number so nothing stale; repo 2 minors behind within range (lock-only). Zod 4 vs 3 is worth stating since schemas API differs. |
| supabase-js (not in table) | - | dashboard/super-admin `latest` -> 2.117.2; mobile `^2.110.7` -> 2.110.7 | 2.117.3 | Not in Stack table; mobile and web are 7 minors apart. Optional mention. |

## Supabase Vault / pgsodium detail (AD-15 and Stack row)

- Supabase features page (supabase.com/docs/guides/getting-started/features): row "Vault - Manage secrets safely in Postgres - **Public Alpha**". Public Alpha is below Beta in Supabase's stated ladder (Private Alpha, Public Alpha, Beta, GA).
- github.com/supabase/vault README header: "Introduction to the Vault (Beta)". Vault docs page itself carries no status label; the linked blog is "Vault now in beta". Sources conflict (Alpha vs Beta); neither says GA. No GA announcement found.
- pgsodium page: "Supabase does not recommend the usage of pgsodium as it will be deprecated"; "Vault doesn't depend on pgsodium and is not affected by this deprecation." Vault shares the per-project root key. So the spine's "pgsodium is pending deprecation in its favor" is correct, and AD-15's "chosen over pgsodium" is vendor-aligned. Stronger and more precise wording available: Vault is independent of pgsodium (repo confirmed locally: no pgsodium extension installed, per decisions.md 2026-08-17).
- AD-15 itself has no status claim, but its heading/Rule predate the 2026-08-17 hands-on confirmation (Story 4.13). The Stack row still says "confirm ... before treating as hard dependency" although Vault is now in production use with real gym credentials (Story 4.13; 0052/0054/0083). The row is stale as a to-do: it should record the outcome (usable, pgsodium absent) and the residual risk that Supabase does not label it GA.

## Not confirmed / caveats

- Vault GA status: could not find a GA announcement; Alpha vs Beta labels conflict between Supabase pages. A human should check the Supabase changelog / support if an SLA matters for payment credentials.
- Expo SDK 57 -> RN 0.86 / React 19.2 mapping taken from the earlier review plus lockfile (RN 0.86.3, React 19.2.3 resolved); not re-fetched from expo.dev this pass.
- pnpm latest version not checked.
- Next.js 16.4.0 release content (breaking changes, Node/React requirements) not reviewed; only that it is npm `latest`.
- Prior review's file says Next 16.2.10 / Expo 57.0.1 and "Stack table lines 190-201" - that review is against an older spine; its numbers are superseded.

## Suggested spine edits (not applied)

1. Next.js row: drop the fixed number or say "16.3.x resolved (lock 16.3.8); 16.4.0 latest as of 2026-10-11; repo uses `latest` specifier".
2. Expo row: 57.0.x (repo ~57.0.20; latest 57.0.27), RN 0.86.3, React 19.2.3.
3. Turborepo row: 2.10.3 pinned, 2.11.x current -> write "2.x".
4. Vault row: replace the confirm-me note with the outcome and "Supabase labels Vault Public Alpha/Beta, not GA; independent of pgsodium (deprecating)".
5. TanStack Query: "dashboard only, v5"; Zod: "v4".
