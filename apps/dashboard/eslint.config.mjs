import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

// `next/core-web-vitals`/`next/typescript` are native ESLint 9 flat-config
// arrays (eslint-config-next 16.x) -- imported directly rather than through
// `FlatCompat.extends(...)`, which forces the legacy eslintrc validator path
// and crashes ("Converting circular structure to JSON") against these
// packages' self-referencing plugin objects, a pre-existing incompatibility
// this story's first real `pnpm lint` run surfaced (confirmed to reproduce
// identically with zero i18n-related config, i.e. unrelated to Story 1.10's
// own changes -- see docs/decisions.md).
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ...i18next.configs["flat/recommended"],
    rules: {
      "i18next/no-literal-string": [
        2,
        {
          // NOTE (code review, Story 1.10 follow-up): the plugin's default
          // `mode: "jsx-text-only"` only checks a literal whose *direct* AST
          // parent is JSXElement/JSXFragment -- every JSX attribute value
          // (aria-label="...", alt="...") has JSXAttribute as its direct
          // parent instead, so the `jsx-attributes` list below is currently
          // dead configuration, never consulted -- a hardcoded aria-label
          // can slip past CI (AC #1) undetected. Switching to `mode:
          // "jsx-only"` does close that gap, but it also starts checking
          // *every* string literal anywhere inside a JSX subtree, not just
          // attributes -- CSS variant enums (variant="outline"), htmlFor
          // refs, state-machine action strings, fallback display chars
          // (`?? "—"`), etc. -- which surfaced ~130 false positives
          // across both apps when tried. Properly scoping that needs a
          // dedicated `callees`/`object-properties` exclude-list tuning
          // pass per app, out of scope for a single patch; tracked in
          // deferred-work.md instead of shipping an overly broad exclude
          // list that would risk hiding real content.
          "jsx-attributes": {
            exclude: [
              "className",
              "styleName",
              "style",
              "type",
              "key",
              "id",
              "width",
              "height",
              "href",
              "aria-hidden",
              "download",
              "rel",
              "target",
            ],
          },
          words: {
            // Options are shallow-merged over the plugin's defaults
            // (lib/options/defaults.js), so its default `words.exclude`
            // entries are repeated here rather than lost -- except the
            // htmlEntities list, which isn't re-exported at a stable public
            // path and isn't worth a fragile deep import for this rarely-hit
            // case.
            exclude: [
              "[0-9!-/:-@[-`{-~]+",
              "[A-Z_-]+",
              "^GymOS$",
              "^·$",
              /^\p{Emoji}+$/u,
            ],
          },
        },
      ],
    },
  },
];

export default eslintConfig;
