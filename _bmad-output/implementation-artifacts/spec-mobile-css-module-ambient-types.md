---
title: 'Fix apps/mobile CSS-module TypeScript ambient declarations'
type: 'bugfix'
created: '2026-07-13'
status: 'done'
route: 'one-shot'
context: []
---

# Fix apps/mobile CSS-module TypeScript ambient declarations

## Intent

**Problem:** CI's `typecheck` job has been failing on `master` because `apps/mobile`'s `tsc --noEmit` reports `TS2307`/`TS2882` on two pre-existing scaffold files (`animated-icon.web.tsx`, `theme.ts`) that import `.css`/`.module.css` files -- Expo SDK 57 supports native CSS Modules for web builds via Metro, but ships no ambient TypeScript declarations for them.

**Approach:** Add `apps/mobile/src/css.d.ts` declaring `*.module.css` (typed default export mapping class names to strings) and a catch-all `*.css` (untyped, side-effect imports) -- the standard pattern used by Create React App/Vite/webpack templates.

## Suggested Review Order

- The fix -- two ambient module declarations resolving the exact `TS2307`/`TS2882` errors CI reported.
  [`css.d.ts:1`](../../apps/mobile/src/css.d.ts#L1)

- One of the two previously-unresolvable imports this fixes.
  [`animated-icon.web.tsx:5`](../../apps/mobile/src/components/animated-icon.web.tsx#L5)

- The other previously-unresolvable import (a side-effect `import '@/global.css'`).
  [`theme.ts:6`](../../apps/mobile/src/constants/theme.ts#L6)
