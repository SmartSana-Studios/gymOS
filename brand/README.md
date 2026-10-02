# Brand assets

Source artwork, kept at full size. Everything the apps actually serve is
derived from these — do not edit a derived file in place, regenerate it.

| File | Used for |
|---|---|
| `gymos-icon-blue.webp` | Dashboard favicon/icon, the landing page's header mark, and the social card ground |
| `gymos-icon-white.webp` | Super-admin and landing-page favicon/icon, and the light-on-dark mark used on dark sections |

Which mark goes where was set 2026-10-02: **white for the landing page and
super-admin, blue for the dashboard.**

## Regenerating the derived icons

`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` and
`app/opengraph-image.png` in each app are generated from the two files above
with `sharp` (already in the lockfile via Next). Sizes: 64px inside the
`.ico`, 256px for `icon.png`, 180px for `apple-icon.png`, 1200×630 for the
social card.

A note for whoever regenerates them: the first artwork supplied for this was
12×12 pixels, which is below even a browser-tab favicon and cannot be
upscaled into anything but mush. Check `sharp(file).metadata()` before
generating from a new source — a too-small input produces files that look
correct in a directory listing and wrong in a browser tab.
