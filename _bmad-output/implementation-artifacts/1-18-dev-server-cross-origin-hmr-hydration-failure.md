---
baseline_commit: ba9d22d9d711c4e867dd315c898ca59ebf228098
---

# Story 1.18: Local Dev Login Impossible over `127.0.0.1` — Cross-Origin HMR Block Silently Prevents Hydration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer running GymOS locally,
I want the dev servers to work when I browse them over `127.0.0.1` as well as `localhost`,
so that I can log in and manually test features instead of hitting a login form that silently does nothing.

**Context — not derived from `epics.md`.** Raised by smartsana on 2026-09-09 while manually testing Story 1.17 on a locally-served stack: login simply did not work ("not logging in"). The same credentials worked against a production build on another port, which initially made it look like a data or auth problem. It is neither: it is a dev-server configuration gap, and it makes *every* interactive feature untestable locally, not just login.

The symptom is maximally misleading, which is why this is worth a story rather than a one-line commit:

- The login page renders correctly and looks completely normal.
- Typing works (native input behaviour needs no JavaScript).
- Clicking **Sign in** appears to do nothing, or flickers and lands back on `/auth/login`.
- **No authentication request is ever made** — so there is nothing in the Supabase logs, no failed-login row, no error toast. Every server-side diagnostic is clean because the server was never asked anything.

### Root cause

Next 16 blocks cross-origin requests to dev-only endpoints. Its definition of "same origin" is *the hostname the dev server was initialized with* — `localhost` by default (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md`). Browsing over `http://127.0.0.1:3001` is therefore cross-origin, even though it is the same machine, the same port and the same process.

The blocked endpoint that matters is the HMR WebSocket at `/_next/hmr`. Next rejects the disallowed upgrade by writing a **malformed, non-HTTP response** rather than a clean 403 — Node's HTTP parser calls it `Parse Error: Expected HTTP/, RTSP/ or ICE/`; Chrome reports `ERR_INVALID_HTTP_RESPONSE`.

Turbopack's dev runtime bootstraps the client application through that socket. With the socket dead, the runtime never executes the app entry, so **React never hydrates** — while the client chunks all download successfully (30/30 → HTTP 200) and *no error is logged anywhere*. The page is inert server-rendered HTML. The Sign in button is a plain `<button type="submit">` inside a form with no `action`, so the click falls through to a **native form GET**, which reloads `/auth/login?` and discards the typed credentials.

That chain — cross-origin block → dead HMR socket → no hydration → inert form → native GET → no auth request — explains every observed symptom, including why production builds were unaffected (no HMR socket exists in a production build).

### Why the first hypothesis was wrong (recorded so it is not re-investigated)

The `proxy.ts` matcher in both apps excludes `_next/webpack-hmr` and carries a comment claiming that exclusion prevents exactly this class of bug. That exclusion is **dead config**: `webpack-hmr` was the pre-Next-16 endpoint name and survives in Next 16 only inside an "upgrading to version 12" doc. Correcting the matcher to `_next/(?:webpack-)?hmr` was tried first and **changed nothing** — the handshake was verified to return a correct `101 Switching Protocols` with the proxy untouched. The proxy is not, and never was, involved. The change was reverted.

The reason the HMR failure looked intermittent and un-reproducible from the shell is that `curl` and a hand-rolled Node client **do not send an `Origin` header**, so both got a clean 101 and the endpoint looked healthy. Only browsers send `Origin` on a WebSocket handshake. Isolating headers one at a time is what identified `Origin` as the trigger.

## Acceptance Criteria

1. **Given** either dev server (`apps/dashboard`, `apps/super-admin`), **when** it is browsed over `http://127.0.0.1:<port>`, **then** React hydrates: React fiber keys (`__reactFiber$`, `__reactProps$`, `__reactEvents$`) are attached to DOM nodes.
2. **Given** the hydrated dev login page over `127.0.0.1`, **when** valid credentials are submitted, **then** a `POST /auth/v1/token` request is made and the browser lands on the authenticated route — not back on `/auth/login`.
3. **Given** the dev server over `127.0.0.1`, **when** the page loads, **then** the browser console contains **no** `/_next/hmr` WebSocket handshake failures.
4. **Given** the existing `localhost` origin, **when** it is used, **then** behaviour is unchanged (no regression).
5. **Given** a production build, **when** it is built and served, **then** it is unaffected — `allowedDevOrigins` is a dev-only setting ignored by `next build`.
6. The fix is applied to **both** Next apps, since both are browsed locally and both exhibited the failure.
7. The root cause is recorded in-code, at the config line, in enough detail that the next person seeing a dead login form does not repeat the multi-hour misdiagnosis.

## Tasks / Subtasks

- [x] Reproduce and isolate the failure (AC #1, #2)
  - [x] A/B the same credentials against dev and a production build on separate ports
  - [x] Establish that no auth request is made at all, ruling out credentials/RLS/GoTrue
  - [x] Probe for React fiber attachment — confirm zero fibers anywhere in dev, present in prod
  - [x] Confirm all client chunks return 200 and no console/page error is emitted
- [x] Identify the true trigger (AC #7)
  - [x] Disprove the `proxy.ts` matcher hypothesis; verify a clean 101 with the proxy untouched; revert the speculative edit
  - [x] Reproduce the browser's `ERR_INVALID_HTTP_RESPONSE` from a Node client by adding browser-like headers
  - [x] Isolate header-by-header: `Origin` breaks the handshake; `Sec-WebSocket-Extensions` does not
  - [x] Establish the allowlist boundary: `localhost` → 101; `127.0.0.1`, `[::1]`, `evil.com` → malformed response
- [x] Apply the fix (AC #1, #4, #5, #6)
  - [x] Add `allowedDevOrigins: ["127.0.0.1", "[::1]"]` to `apps/dashboard/next.config.ts`
  - [x] Add the same to `apps/super-admin/next.config.ts`
  - [x] Document the full causal chain in a comment at the config line (AC #7)
- [x] Verify (AC #1, #2, #3, #4)
  - [x] Dashboard dev over `127.0.0.1`: hydrates, `POST /auth/v1/token` fires, lands on `/`
  - [x] Super-admin dev over `127.0.0.1`: hydrates, console clean
  - [x] Confirm no `/_next/hmr` errors remain in the console
  - [x] Typecheck, lint and the full test suite pass on both apps

### Review Findings

Adversarial code review, 2026-09-09 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, diff `0acecb2^..b04f11f`).

- [x] [Review][Defer] `allowedDevOrigins` covers loopback only, not the other hosts this repo is actually browsed from — `next dev` is invoked with no `-H` in both apps' `package.json:5`, so the server listens on every interface. Browsing dev over a LAN IP (phone testing), the devcontainer's forwarded host, or a Codespaces `*.app.github.dev` URL reproduces the identical silently-inert-page failure under a different hostname. — deferred: **decided 2026-09-09 — keep loopback only.** Widening the allowlist is the wrong safeguard. Next already prints the exact remedy (`add it to "allowedDevOrigins" …`) to the dev-server terminal whenever it blocks a request, for *any* host — including ones we would never think to pre-list — so the failure is already self-diagnosing and the real gap was that nobody read the `pnpm dev` output. That pointer is now in both `proxy.ts` files. Widening also adds dev-time attack surface with no demonstrated need (WSL2 devcontainer; mobile QA goes through TestFlight, not the Next dev server).
- [x] [Review][Patch] AC #7 is only half met — the two artefacts most likely to mislead the next person still assert the disproved hypothesis [apps/dashboard/proxy.ts:14-18, apps/super-admin/proxy.ts:14-18, docs/manual-walkthrough-findings-2026-07-13.md:174-187]
- [x] [Review][Defer] `next: "latest"` makes both config edits version-fragile with a silent failure mode [apps/dashboard/package.json:32] — deferred, pre-existing

## Dev Notes

### Reproduction, for anyone who sees this again

The tell is: **login form renders, click does nothing, and the server logs show no auth attempt.** Check hydration before anything else — it takes one line in the browser console:

```js
Object.keys(document.querySelector("form")).filter((k) => k.startsWith("__react"))
// [] → not hydrated. The page is inert HTML; no client handler will ever run.
```

If that returns `[]`, no amount of investigating credentials, RLS policies or Supabase logs will find anything, because the client never made a request.

### The `Origin` trap

This is the detail that cost the most time and is the one worth remembering:

| Client | Sends `Origin` | Result against dev `127.0.0.1` |
|---|---|---|
| `curl` (default) | no | `101 Switching Protocols` — looks healthy |
| Node `http.request` (hand-rolled) | no | `101 Switching Protocols` — looks healthy |
| Any real browser | **yes** | malformed response → `ERR_INVALID_HTTP_RESPONSE` |

A shell-based check of the WebSocket endpoint will therefore **pass while the app is completely broken in every browser**. Reproduce browser conditions explicitly, or the probe proves nothing.

### Why `[::1]` is included

`localhost` resolves to both `127.0.0.1` and `::1` depending on the resolver and the stack, and `[::1]` was verified to be rejected exactly like `127.0.0.1`. Including it prevents the identical failure appearing on IPv6-first setups.

### Scope boundary

`allowedDevOrigins` is dev-only and ignored by `next build` (AC #5), so this carries no production risk. It deliberately lists only loopback addresses — it is not a wildcard, and the cross-origin protection remains in force for every non-loopback host (`evil.com` was verified to still be rejected).

### Testing standards

No automated test is added. The failure lives in dev-server transport configuration; it is invisible to Vitest (which never starts a dev server or a browser) and to `next build`. A test that could catch it would have to boot `next dev` and drive a real browser over `127.0.0.1` — infrastructure this repo does not have, and disproportionate to a two-line config fix. Verification was performed directly against both running dev servers with a Playwright-driven browser, and the reproduction recipe above is recorded so the check can be repeated by hand in seconds.

### References

- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md` — "Next.js blocks cross-origin requests to dev-only assets and endpoints during development by default"; origins other than "the hostname the server was initialized with (`localhost` by default)" must be allowlisted.
- `apps/dashboard/next.config.ts`, `apps/super-admin/next.config.ts` — the fix and its in-code rationale.
- `apps/dashboard/proxy.ts`, `apps/super-admin/proxy.ts` — **not** involved; the `_next/webpack-hmr` exclusion there is dead pre-Next-16 config, left untouched.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context)

### Debug Log References

Evidence captured during diagnosis, dev (`:3001`) vs production build (`:3002`), same credentials:

```
:3001 dev   final /auth/login   cookies NONE   token/rsc reqs none   react keys: NONE (not hydrated)
:3002 prod  final /             cookies sb-127-auth-token.0/.1       react keys: __reactFiber$,__reactProps$,__reactEvents$
```

Client asset delivery in dev was fully healthy while the app was dead — which is what made this hard:

```
--- port 3001 ---
script responses (non-200 only): (all 30 OK)
failed requests: none
page/console errors: none
```

Origin allowlist boundary, probed against dev `:3001` `/_next/hmr`:

```
(no Origin header)        101 OK
http://127.0.0.1:3001     BROKEN: Parse Error: Expected HTTP/, RTSP/ or ICE/
http://localhost:3001     101 OK
http://[::1]:3001         BROKEN: Parse Error: Expected HTTP/, RTSP/ or ICE/
http://evil.com           BROKEN: Parse Error: Expected HTTP/, RTSP/ or ICE/
```

Decisive pre-fix control — same server, same credentials, hostname the only variable:

```
127.0.0.1:3001  react keys NONE   network after click: GET /auth/login   final: /auth/login?
localhost:3001  react keys present network after click: POST /auth/v1/token | GET /?_rsc  final: /
```

Post-fix, over the previously-broken `127.0.0.1`:

```
dashboard  :3001  react keys present  POST /auth/v1/token | GET /?_rsc | GET /?_rsc  final: http://127.0.0.1:3001/
super-admin:3000  react keys present  console errors: (clean)
```

### Completion Notes List

- Root cause is Next 16's cross-origin dev protection, not authentication, not the Supabase client, and not `proxy.ts`. The failure surfaced as an auth bug purely because hydration is what turns the login form into something that can make a request.
- A first hypothesis — that `proxy.ts`'s stale `_next/webpack-hmr` exclusion let the auth redirect intercept the HMR upgrade — was implemented, tested, **disproved** (the handshake returns 101 with the proxy unmodified) and reverted. The stale exclusion is real but inert; it was deliberately left alone rather than bundled into this fix, so the diff contains only what was demonstrated to matter. It is noted here so the next reader does not chase it.
- The bug affects far more than login: with no hydration, *every* client interaction in local dev is dead. Login was simply the first thing anyone tried.
- Two config lines, both dev-only. Production builds never had this failure and are untouched.
- Verification: `pnpm typecheck` — Done, 0 errors on both apps. `pnpm lint` — 0 errors (15 pre-existing unused-var warnings in test files, unrelated). `pnpm test` — dashboard 33 files / 227 tests passed, super-admin 2 files / 25 tests passed.

### File List

- `apps/dashboard/next.config.ts` — MODIFIED: added `allowedDevOrigins` + rationale comment
- `apps/super-admin/next.config.ts` — MODIFIED: added `allowedDevOrigins` + rationale comment

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-09 | 1.0 | Root-caused local dev login failure to Next 16 cross-origin HMR blocking over `127.0.0.1`; fixed via `allowedDevOrigins` in both apps; verified hydration and login restored. | Claude Opus 5 (1M context) |
