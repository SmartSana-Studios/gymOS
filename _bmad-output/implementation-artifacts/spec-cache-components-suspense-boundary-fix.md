---
title: 'Fix Cache Components Suspense-boundary violations in both apps root/nav layouts'
type: 'bugfix'
created: '2026-07-13'
status: 'done'
context: []
baseline_commit: '8107dfe57397d89048063cf3a81378ab0e8a678f'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Both apps' root `app/layout.tsx` call `getRequestLocale()` directly (a dynamic, cookie/DB-backed read) outside a `<Suspense>` boundary, and both apps' nav-shell layouts (`apps/dashboard/app/(dashboard)/layout.tsx`, `apps/super-admin/app/(admin)/layout.tsx`) independently do the same with their own auth/locale reads. Under `cacheComponents: true`, this silently hard-fails a real `next build` (confirmed: dashboard's `/_not-found`, super-admin's `/gyms/[id]`) instead of just a dev warning — `cacheComponents` is currently disabled in both apps' `next.config.ts` as an interim stopgap from a prior fix.

**Approach:** Apply this codebase's own established pattern (`apps/super-admin/app/(admin)/gyms/page.tsx`, `gyms/[id]/page.tsx`) to all four layouts: keep each layout's outer export a plain sync component with no dynamic reads, move the dynamic read + redirect/error logic into a new inner `async` component, and wrap that inner component in `<Suspense>`. Re-enable `cacheComponents: true` once both apps build cleanly.

## Boundaries & Constraints

**Always:**
- Match the existing pattern exactly: outer sync default export renders `<Suspense fallback={...}><XxxData>{children}</XxxData></Suspense>`; the inner `async function XxxData` does the actual dynamic work.
- Root layouts: `<html lang="en" suppressHydrationWarning>` becomes a static default (no longer the resolved-per-request locale) — the `lang` attribute is metadata, not user-visible content, and `suppressHydrationWarning` is already present precisely because this element already tolerates attribute mismatches (next-themes). The real per-user locale still reaches `I18nClientProvider` correctly inside the Suspense boundary.
- Nav-shell layouts (`(dashboard)/layout.tsx`, `(admin)/layout.tsx`): preserve the exact existing auth-check/redirect/error-branch behavior — only relocate it inside the new Suspense-wrapped async component. `redirect()` from inside a Suspense-wrapped async Server Component is a supported Next.js pattern (same mechanism `gyms/[id]/page.tsx`'s `notFound()` already relies on).
- Fallback for all four: `null` (not a loading skeleton) — `body { @apply bg-background }` in both apps' `globals.css` already renders the correct background with no unstyled flash, and `getRequestLocale()`/`getDashboardShellContext()` resolve in a single fast, in-request-memoized read, so a visible blank frame is not expected in practice.
- Do not touch `gyms/page.tsx`, `gyms/[id]/page.tsx`, or `auth/login/page.tsx` — already compliant.

**Ask First:** none anticipated — this is a mechanical application of an existing, already-approved pattern to two more layout levels per app.

**Never:** do not introduce a loading skeleton/spinner component for these four layouts (out of scope — `null` is the deliberate choice per above); do not change any RLS/auth logic itself, only where it's called from.

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/layout.tsx` — root layout, currently awaits `getRequestLocale()` directly
- `apps/dashboard/app/(dashboard)/layout.tsx` — awaits `getDashboardShellContext()` directly (+ `getRequestLocale()` in its error branch)
- `apps/super-admin/app/layout.tsx` — root layout, same shape as dashboard's
- `apps/super-admin/app/(admin)/layout.tsx` — awaits `getClaims()` + `getRequestLocale()` directly, has two `redirect()` calls
- `apps/dashboard/next.config.ts`, `apps/super-admin/next.config.ts` — flip `cacheComponents` back to `true` once builds pass
- `apps/super-admin/app/(admin)/gyms/page.tsx` — reference pattern only, not modified

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard/app/layout.tsx` — split into sync shell + `Suspense`-wrapped async `LocaleShell` — closes the `/_not-found` build failure
- [x] `apps/dashboard/app/(dashboard)/layout.tsx` — split into sync shell + `Suspense`-wrapped async data component, preserving the error-div and redirect branches verbatim
- [x] `apps/super-admin/app/layout.tsx` — same split as dashboard's root layout
- [x] `apps/super-admin/app/(admin)/layout.tsx` — split into sync shell + `Suspense`-wrapped async data component, preserving both `redirect()` branches and the nav JSX verbatim
- [x] `apps/dashboard/next.config.ts`, `apps/super-admin/next.config.ts` — `cacheComponents: false` → `true`

**Acceptance Criteria:**
- Given `cacheComponents: true` in both apps, when `next build` runs, then both complete with exit code 0 and no "accessed outside of Suspense" error
- Given a signed-in owner/super_admin session, when any existing page loads, then role-gating/redirect behavior is unchanged from before this fix

## Design Notes

Dashboard's root-layout split (super-admin's is the same shape, plus `(admin)/layout.tsx` gets the nav-shell treatment shown for `(dashboard)/layout.tsx` below):

```tsx
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <Suspense fallback={null}>
          <LocaleShell>{children}</LocaleShell>
        </Suspense>
      </body>
    </html>
  );
}

async function LocaleShell({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <I18nClientProvider locale={locale}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </I18nClientProvider>
  );
}
```

`(dashboard)/layout.tsx` / `(admin)/layout.tsx` follow the same shape but the inner async component keeps its existing `redirect()`/error-div logic verbatim, just relocated:

```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DashboardLayoutData>{children}</DashboardLayoutData>
    </Suspense>
  );
}

async function DashboardLayoutData({ children }: { children: React.ReactNode }) {
  // ...exact existing body of the current default export, unchanged...
}
```

## Verification

**Commands:**
- `pnpm --filter @gymos/dashboard exec next build` -- expected: exit 0, no Suspense/prerender error
- `pnpm --filter @gymos/super-admin exec next build` -- expected: exit 0, no Suspense/prerender error
- `pnpm --filter @gymos/dashboard exec tsc --noEmit` / `pnpm --filter @gymos/super-admin exec tsc --noEmit` -- expected: only the pre-existing, documented `ThemeProvider`/`layout.tsx:35` typing error remains
- `wsl.exe -e bash -c "cd /mnt/e/coding_projects/gym_os && supabase test db"` -- expected: all 149 pgTAP assertions still pass (regression check only; this change touches no RLS/SQL)

## Suggested Review Order

**Suspense-boundary pattern (design intent)**

- Canonical instance of the split: sync shell renders a Suspense-wrapped async component; `<html lang>` is now static.
  [`dashboard/app/layout.tsx:25`](../../apps/dashboard/app/layout.tsx#L25)

- The relocated dynamic read — locale resolution moved here unchanged, now inside the boundary.
  [`dashboard/app/layout.tsx:41`](../../apps/dashboard/app/layout.tsx#L41)

- Identical split applied to super-admin's root layout — same shape, confirms consistency across apps.
  [`super-admin/app/layout.tsx:25`](../../apps/super-admin/app/layout.tsx#L25)

**Nav-shell security boundary (highest risk — auth check relocated, not rewritten)**

- Dashboard's auth gate now lives behind Suspense; verify the redirect/error-branch body below is untouched from before.
  [`dashboard/app/(dashboard)/layout.tsx:34`](../../apps/dashboard/app/(dashboard)/layout.tsx#L34)

- The `redirect("/auth/login")` call itself — verified via production build + curl that this still returns a true HTTP 307, not a client-side-only redirect.
  [`dashboard/app/(dashboard)/layout.tsx:59`](../../apps/dashboard/app/(dashboard)/layout.tsx#L59)

- Super-admin's equivalent auth gate — two `redirect()` branches (missing claims, wrong role) relocated verbatim.
  [`super-admin/app/(admin)/layout.tsx:28`](../../apps/super-admin/app/(admin)/layout.tsx#L28)

**Config flip (unblocks the build)**

- `cacheComponents: false → true`, now safe because the boundary violations above are fixed.
  [`dashboard/next.config.ts:8`](../../apps/dashboard/next.config.ts#L8)

- Same flip for super-admin, with an updated comment reflecting the fix.
  [`super-admin/next.config.ts:8`](../../apps/super-admin/next.config.ts#L8)
