---
baseline_commit: 69c348ffeec2400515dbba6ab7b487a0ed05e646
---

# Story 15.1: Splash Screen & App Icon Fix

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym member,
I want the app's launch screen and icon to reflect GymOS's actual brand instead of an unbranded Expo-starter default,
so that my first impression of the app looks intentional rather than like an unfinished template.

## Acceptance Criteria

1. **Given** `apps/mobile/app.json`'s `expo-splash-screen` plugin config currently sets `backgroundColor: "#208AEF"` — a bright blue unrelated to `Brand.primary` (`#1B2A41`) or the mobile dark theme's actual background (`#0A0F17`) — **when** this story ships, **then** `backgroundColor` is updated to `#0A0F17`, matching the dark theme the rest of the app already uses.
2. **Given** `apps/mobile`'s icon is defined across three separate Expo (SDK 57) surfaces, not one file — the top-level `icon` (`assets/images/icon.png`), the iOS-specific `ios.icon` Icon Composer bundle (`assets/expo.icon/`), and `android.adaptiveIcon` (its own three PNG layers plus a separate `backgroundColor: "#E6F4FE"`) — and all three currently render the unbranded Expo-starter default (a generic blue "A" glyph / the literal "expo-symbol" layer / a light-blue adaptive background), **when** this story ships, **then** all three surfaces are rebranded consistently from one source mark: `icon.png` replaced (1024×1024, GymOS mark on a `primary` `#1B2A41` or transparent ground); `expo.icon/icon.json`'s `fill` changed from the default Expo-blue gradient to `primary` (`#1B2A41`, solid or a `primary`→`accent` gradient) and its `expo-symbol`/`grid` layers replaced with the GymOS mark, keeping the bundle's Icon Composer JSON structure valid; `android.adaptiveIcon.backgroundColor` changed from `#E6F4FE` to `primary` (`#1B2A41`) and its three PNG layers (`foregroundImage`/`backgroundImage`/`monochromeImage`) regenerated from the same mark.
3. **Given** `assets/images/splash-icon.png` is currently a blank placeholder, separate from all three icon surfaces above, **when** this story ships, **then** it is replaced with the same GymOS mark (accent-orange bar-glyph), sized per Expo's splash `imageWidth` convention (currently `76`, re-tune only if the new mark's proportions require it), rendered on the `#0A0F17` background from AC #1.
4. **Given** `apps/mobile/assets/images/` also contains `react-logo.png`/`react-logo@2x.png`/`react-logo@3x.png`, `expo-logo.png`, `expo-badge.png`, `expo-badge-white.png`, and `tutorial-web.png` — unreferenced Expo-starter template leftovers — **when** this story ships, **then** each file confirmed (via `grep -rn` across `apps/mobile/src` and `apps/mobile/app.json` — zero references, not assumed from the filename alone) to have no remaining reference is deleted as part of the same asset cleanup; any file a grep does find referenced is left in place and flagged in Completion Notes, not deleted speculatively.
5. **Given** a real cold launch is the only way to confirm the splash → app transition actually reads as one continuous brand rather than a mismatched flash, **when** this story ships, **then** it is verified two ways: (a) `npx expo prebuild --no-install --platform android` completes without error (matching Story 14.1's precedent command in this environment), confirming `app.json`'s edited plugin config is structurally valid; (b) an on-device/simulator cold-launch visual check — covering both the splash and every icon surface, since prebuild alone doesn't validate the iOS Icon Composer bundle — is left as the user's own manual QA step, per this project's established convention that in-app visual verification on a real device is performed by the user, not simulated by the dev agent.

## Tasks / Subtasks

- [x] **Task 1: Produce the source mark asset** (AC: #2, #3)
  - [x] Derive a square, isolated version of the accent-orange bar-glyph from `apps/dashboard/public/gymos-logo-full-white.webp` (the full lockup is a horizontal wordmark — "Gym" in white + a bar-glyph + "OS" in orange; the glyph alone, without the wordmark text, is the reusable square mark). No new brand design — crop/re-export from the existing asset.
  - [x] Export the mark in the raster/vector formats each surface below actually needs (flat PNG for `icon.png`/`splash-icon.png`/Android layers; SVG or PNG layer(s) for the Icon Composer bundle — see Task 4).

- [x] **Task 2: Fix the splash screen** (AC: #1, #3)
  - [x] `apps/mobile/app.json` → `plugins` → `expo-splash-screen` entry: `backgroundColor` `"#208AEF"` → `"#0A0F17"`.
  - [x] Replace `assets/images/splash-icon.png` with the new mark (Task 1), keeping the existing `imageWidth: 76` unless the new mark's proportions require re-tuning — if re-tuned, note the new value and why in Completion Notes.

- [x] **Task 3: Fix `icon.png`** (AC: #2)
  - [x] Replace `assets/images/icon.png` (currently a generic blue "A" glyph, 1024×1024) with the new mark at the same dimensions.

- [x] **Task 4: Fix the iOS Icon Composer bundle** (AC: #2)
  - [x] `assets/expo.icon/icon.json`: change `fill.automatic-gradient` from the default Expo-blue value (`"extended-srgb:0.00000,0.47843,1.00000,1.00000"`) to `primary` (`#1B2A41`) — either a flat fill or a `primary`→`accent` two-stop gradient; either is acceptable, note which was chosen in Completion Notes.
  - [x] Replace the `expo-symbol` layer's image (`Assets/expo-symbol 2.svg`) with the GymOS mark (Task 1) as an SVG, or restructure `icon.json`'s `layers` array if a single flat mark renders better than the existing two-layer (symbol + grid) composition — this bundle format supports 1+ layers, it does not have to keep exactly two.
  - [x] Decide whether the existing `grid.png` decorative layer is kept (re-tinted/re-toned to suit the new mark) or dropped entirely — this is a real design judgment call the dev agent should make explicitly and record in Completion Notes, not silently decide either way. Default to dropping it if the new single-mark composition reads cleanly without it; keep only if it visibly improves the result.
  - [x] This is Xcode 16's Icon Composer bundle format — normally authored via Xcode's Icon Composer GUI, not hand-typed JSON. Hand-editing `icon.json` directly (swapping `fill`/`layers`/image references while keeping the existing schema shape and `supported-platforms` block untouched) is a reasonable and sufficient implementation path; do not require access to Xcode's GUI tool to complete this task.

- [x] **Task 5: Fix the Android adaptive icon** (AC: #2)
  - [x] `apps/mobile/app.json` → `android.adaptiveIcon.backgroundColor`: `"#E6F4FE"` → `"#1B2A41"`.
  - [x] Regenerate `assets/images/android-icon-foreground.png`, `android-icon-background.png`, and `android-icon-monochrome.png` from the same new mark (Task 1) — Android's adaptive-icon system composites these three independently, so all three must agree with each other and with `icon.png`/the Icon Composer bundle, not just the foreground layer.

- [x] **Task 6: Clean up unused Expo-starter template assets** (AC: #4)
  - [x] `grep -rn` across `apps/mobile/src` and `apps/mobile/app.json` for each of: `react-logo`, `expo-logo`, `expo-badge`, `tutorial-web`.
  - [x] Delete every file confirmed to have zero remaining references (`react-logo.png`/`@2x`/`@3x`, `expo-logo.png`, `expo-badge.png`/`expo-badge-white.png`, `tutorial-web.png`). If any is actually referenced, leave it and note which in Completion Notes — do not delete on filename assumption alone.

- [x] **Task 7: Verify** (AC: #5)
  - [x] Run `npx expo prebuild --no-install --platform android` (matching Story 14.1's exact precedent command — see Dev Notes for the side effect it hit) and confirm it completes without error — this is the structural check that the edited `app.json`/Icon Composer bundle are valid, not a visual check. The iOS Icon Composer bundle (`assets/expo.icon/`) is consumed at Xcode build time, not by `expo prebuild` itself, so an `--platform android` prebuild is the meaningful structural check available in this (Linux/non-macOS) environment; if `--platform ios` prebuild is available and runnable here, run it too, but don't block the story on an Xcode-only verification path that may not exist in this environment.
  - [x] This is a Continuous Native Generation project (no `android/`/`ios/` committed) — delete the generated `android/` directory after verification, matching Story 14.1's precedent. Story 14.1 also found `expo prebuild` silently rewrote `package.json`'s `android`/`ios` scripts from `expo start --*` to `expo run:*` as an unrelated side effect — check `git status`/diff `package.json` after prebuild and revert those two lines if the same thing happens here; don't leave it as an unintended diff.
  - [x] Flag the on-device/simulator cold-launch visual confirmation as a manual QA item for the user, per this project's established convention (every prior mobile story's Dev Agent Record makes the same distinction) — this is not a gap to apologize for or work around, it's simply not the dev agent's task to perform.

## Dev Notes

### Why this is three surfaces, not one — read `app.json` directly, don't assume from the filesystem

A naive pass at "fix the app icon" would replace `assets/images/icon.png` and consider it done. That is wrong. `app.json` actually wires:

```jsonc
"icon": "./assets/images/icon.png",           // top-level fallback (used where no platform-specific icon is set)
"ios": { "icon": "./assets/expo.icon" },        // iOS-specific override: an Xcode 16 Icon Composer bundle, NOT a flat PNG
"android": {
  "adaptiveIcon": {
    "backgroundColor": "#E6F4FE",               // its OWN color, independent of icon.png
    "foregroundImage": "./assets/images/android-icon-foreground.png",
    "backgroundImage": "./assets/images/android-icon-background.png",
    "monochromeImage": "./assets/images/android-icon-monochrome.png"
  }
}
```

`assets/expo.icon/` is a directory, not a file — `icon.json` (layer/fill config) + `Assets/expo-symbol 2.svg` + `Assets/grid.png`. This is Expo SDK 53+'s support for Xcode 16's newer Icon Composer format (dynamic/tinted/dark-mode-aware iOS icons), introduced well after most LLM training data's knowledge of Expo's icon system — **per `apps/mobile/AGENTS.md`'s standing warning ("Expo HAS CHANGED... read the exact versioned docs"), do not assume `icon.png` alone covers iOS.** `icon.json`'s current `fill` value (`"extended-srgb:0.00000,0.47843,1.00000,1.00000"` ≈ Expo's own brand blue) and its `expo-symbol`/`grid` layers are exactly the same category of un-rebranded default as `icon.png` and the splash `backgroundColor` — this was found by opening `app.json` and the bundle's `icon.json` directly, not inferred.

### The source mark

`apps/dashboard/public/gymos-logo-full-white.webp` is GymOS's actual, real brand asset (used today in `apps/dashboard`/`apps/super-admin`) — a horizontal lockup: white "Gym" + an orange bar-glyph + orange "OS". The bar-glyph alone is the reusable square mark for all icon/splash surfaces in this story. This is the only existing brand asset in the repo usable for this purpose (confirmed via repo-wide search for `*logo*` during the UX pass — see `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/.memlog.md`, 2026-09-02 entries). No new brand design is required or in scope; producing crops/exports at the sizes each surface needs is asset production, not design work.

### Web favicon — explicitly out of scope

`app.json`'s `web.favicon` (`assets/images/favicon.png`) is also presumably an unbranded default, but `apps/mobile`'s `web` script (`expo start --web`) is a local dev-only entry point — there is no `expo export --platform web` step anywhere in this repo's CI or build scripts, so the web target is not a shipped surface. Left untouched by this story; flag as a follow-up only if the project later ships a real web build.

### This story is asset/config only — no application logic changes

`architecture.md` has zero mentions of splash/icon/Expo-asset conventions (confirmed via grep) — there is no architectural constraint this story interacts with beyond `app.json`'s own schema. No TypeScript/JSX source changes, no new dependencies, no database/migration work. The verification bar is correspondingly different from a typical story: `pnpm typecheck`/`pnpm lint` are unaffected by this story's changes (asset files and one JSON config aren't covered by either), so the load-bearing check is `expo prebuild` succeeding structurally (Task 7) plus the user's own on-device visual confirmation — not a test-suite assertion.

### Relationship to Stories 15.2–15.4

This story is fully independent of the other three Epic 15 stories (no shared component/file overlap with `Card.tsx`/`Badge.tsx`/Home/Profile) — it can ship in any order relative to them.

### Project Structure Notes

- No new source files. Modified: `apps/mobile/app.json`, `apps/mobile/assets/expo.icon/icon.json` (+ its `Assets/` images), `apps/mobile/assets/images/{icon.png,splash-icon.png,android-icon-foreground.png,android-icon-background.png,android-icon-monochrome.png}`.
- Deleted (pending Task 6's grep confirmation): `apps/mobile/assets/images/{react-logo.png,react-logo@2x.png,react-logo@3x.png,expo-logo.png,expo-badge.png,expo-badge-white.png,tutorial-web.png}`.
- No `apps/mobile/src/` changes — this story touches only `app.json` and `assets/`.
- No database/migration/RLS/pgTAP surface.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 15: Mobile Experience Quality Pass / Story 15.1] — full AC text and origin
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md#Brand & Style — Icon & Launch identity] — the brand-token mapping (`primary`/`accent`) this story implements
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Cross-Cutting Components — App Launch (Splash Screen)] — behavioral spec, links the `mockups/key-launch-splash.html` reference mock
- [Source: apps/mobile/app.json] — the exact three-surface icon config and splash plugin block this story edits
- [Source: apps/mobile/assets/expo.icon/icon.json] — current unbranded Icon Composer bundle config
- [Source: apps/mobile/AGENTS.md] — standing warning that Expo's conventions have changed since most training data; do not assume unversioned knowledge of the icon system
- [Source: apps/dashboard/public/gymos-logo-full-white.webp] — the real brand asset this story derives the mark from
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/.memlog.md, 2026-09-02 entries] — the UX pass session that diagnosed this finding and the three-surface correction made during story creation

## Change Log

- 2026-09-02: dev-story: implemented all 7 tasks. Derived the GymOS mark (two orange bars flanking a white ring "G") from `apps/dashboard/public/gymos-logo-full-white.webp` via a `sharp`-based crop/composite pipeline (no ImageMagick/PIL available in this environment) and applied it across all three icon surfaces (`icon.png`, iOS Icon Composer bundle, Android adaptive icon) plus the splash image, replacing the unbranded Expo-starter defaults (blue "A" glyph, `#208AEF` splash, `#E6F4FE` adaptive background, Expo-blue Icon Composer fill). Deleted 4 confirmed-unreferenced Expo-starter template assets (`react-logo.png`/`@2x`/`@3x`, `tutorial-web.png`); left `expo-logo.png`/`expo-badge*.png` in place (both still referenced by `animated-icon(.web).tsx`/`web-badge.tsx`). Verified via `npx expo prebuild --no-install --platform android` (clean), reverted the known `package.json` script-rewrite side effect (matching Story 14.1's precedent), and deleted the generated `android/` directory. Status: ready-for-dev → review.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npx expo prebuild --no-install --platform android` — completed cleanly (`✔ Created native directory`, `✔ Updated package.json`, `✔ Finished prebuild`); `apps/mobile/app.json` parsed and re-validated as JSON post-edit.
- `git diff apps/mobile/package.json` post-prebuild showed the same `expo start --android`/`--ios` → `expo run:android`/`run:ios` rewrite Story 14.1 hit; reverted with `git checkout -- package.json`, then `rm -rf android` (CNG project, no native dirs committed).
- Environment note: this devcontainer's `python3` stdlib is missing the `json` module (`ModuleNotFoundError: No module named 'json'`), so `_bmad/scripts/resolve_customization.py` could not run — resolved the workflow customization block manually per the skill's documented fallback (read `customize.toml`; no team/user override files exist). No ImageMagick or Python PIL available either — all image production for this story used the `sharp` npm package (already vendored in the monorepo's pnpm store) via ad-hoc Node scripts, not committed to the repo.

### Completion Notes List

- **Source mark derivation (Task 1):** `gymos-logo-full-white.webp` is a horizontal lockup — 2 orange bars, a white ring shaped like a "G", 2 more orange bars, then "gym"/"OS" text. Pixel-scanned the alpha channel to find the glyph's exact bounds (x:[0,349), y:[0,204) of the 838×204 source) — the bars+ring portion, with no wordmark text — and used that as the reusable square-ish mark for every surface, per Dev Notes. This is the only brand asset in the repo; no vector/higher-res source exists, so all surfaces are lanczos3 upscales of this ~349×204 raster crop. Visually clean at every target size checked (1024px icon down to 133px splash) since the mark is large flat geometric shapes, but flagged here as a known resolution ceiling if a much larger surface is ever needed later.
- **Icon Composer fill (Task 4):** chose a flat solid fill (`primary` `#1B2A41`, converted to `extended-srgb:0.10588,0.16471,0.25490,1.00000`) under the existing `automatic-gradient` key, rather than a hand-specified two-stop gradient — Icon Composer's `automatic-gradient` already derives its own subtle shading from one input color, so a single flat value was sufficient and matches how the original Expo-blue value was specified (also a single flat value, not an explicit 2-stop gradient).
- **Icon Composer layer restructure (Task 4):** replaced the original two-layer composition (`expo-symbol 2.svg` + `grid.png`) with a single flat raster layer (`gymos-mark.png`, 1024×1024 transparent PNG) rather than hand-tracing the ring+bars shape as SVG paths — avoids fidelity loss from manually vectorizing a shape with a circular cutout, and this bundle format already had raster (`grid.png`) and vector layers coexisting, so a raster-only single layer is a supported configuration. Deleted the now-orphaned `expo-symbol 2.svg` and `grid.png` from `Assets/` (both fully superseded, not used by any remaining `icon.json` layer reference).
- **Grid decorative layer (Task 4):** dropped, not kept/re-toned. The new mark (ring + bars) reads as a clear, high-contrast glyph on its own at icon sizes; the grid was a generic Expo-starter decorative texture unrelated to brand and added visual noise without communicating anything GymOS-specific.
- **Splash image sizing (Task 2):** kept `imageWidth: 76` unchanged in `app.json` — that value only controls the image's *display width*; height is derived by Expo from the file's own aspect ratio. Since the new mark's aspect ratio (≈1.71:1) differs from the old "A" glyph's (≈1.07:1), the new `splash-icon.png` file itself is 228×133px (previously 228×213px) to preserve the mark's true proportions — this is a file-dimension change following naturally from the new mark's shape, not a "re-tune" of the `imageWidth` config value itself. Per AC #3, the dark background (`#0A0F17`) is baked directly into the PNG (not left transparent) so it's pixel-identical to the plugin's `backgroundColor`, eliminating any seam risk at the image's edges.
- **Android layer generation (Task 5):** `android-icon-background.png` is a flat `#1B2A41` fill (512×512, no decorative guide circles — the original template file was pure Expo Icon-Composer-guide artwork, not meant to ship); `android-icon-foreground.png` places the mark at ~45% of canvas width within the 512×512 transparent-background safe zone (matching the previous default's proportions); `android-icon-monochrome.png` is a flat-black silhouette (alpha channel from the mark, RGB forced to `#000000`) at 432×432, per Android 13+'s themed-icon convention where the system re-tints monochrome layers and only the alpha shape matters.
- **Task 6 cleanup — kept vs. deleted:** `grep -rn` across `apps/mobile/src` and `app.json` found `expo-logo.png` referenced in `animated-icon.tsx`/`animated-icon.web.tsx`, and `expo-badge.png`/`expo-badge-white.png` referenced in `web-badge.tsx` — all three left in place per the AC's "leave and flag, don't delete on filename assumption" instruction. `react-logo.png`/`@2x`/`@3x` and `tutorial-web.png` had zero references and were deleted.
- **Manual QA (AC #5b):** on-device/simulator cold-launch visual confirmation (splash → app transition, all three icon surfaces including the iOS Icon Composer bundle which `expo prebuild --platform android` cannot validate) is left for the user's own manual verification, per this project's established convention — not performed by this agent.

### File List

**Modified:**
- `apps/mobile/app.json` (splash `backgroundColor`, Android `adaptiveIcon.backgroundColor`)
- `apps/mobile/assets/expo.icon/icon.json` (fill color, single-layer restructure)
- `apps/mobile/assets/images/icon.png`
- `apps/mobile/assets/images/splash-icon.png`
- `apps/mobile/assets/images/android-icon-foreground.png`
- `apps/mobile/assets/images/android-icon-background.png`
- `apps/mobile/assets/images/android-icon-monochrome.png`

**Added:**
- `apps/mobile/assets/expo.icon/Assets/gymos-mark.png`

**Deleted:**
- `apps/mobile/assets/expo.icon/Assets/expo-symbol 2.svg`
- `apps/mobile/assets/expo.icon/Assets/grid.png`
- `apps/mobile/assets/images/react-logo.png`
- `apps/mobile/assets/images/react-logo@2x.png`
- `apps/mobile/assets/images/react-logo@3x.png`
- `apps/mobile/assets/images/tutorial-web.png`
