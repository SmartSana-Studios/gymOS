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
  // A standalone `{ ignores }` object (no other keys) applies globally,
  // excluding these files from every config below -- not just the i18next
  // rule. Confirmed-dead Supabase-starter demo/tutorial scaffolding (Story
  // 1.10 Dev Notes): no real gym_os route links to `/` or `/protected`, and
  // this content is Supabase's own onboarding tutorial copy, not product
  // surface -- excluded rather than fixing unrelated pre-existing lint
  // findings (e.g. react-hooks/set-state-in-effect in theme-switcher.tsx)
  // in code nothing in the app actually reaches.
  {
    ignores: [
      "app/page.tsx",
      "app/protected/**",
      "components/tutorial/**",
      "components/auth-button.tsx",
      "components/logout-button.tsx",
      "components/theme-switcher.tsx",
      "components/deploy-button.tsx",
      "components/hero.tsx",
      "components/env-var-warning.tsx",
      "components/next-logo.tsx",
      "components/supabase-logo.tsx",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ...i18next.configs["flat/recommended"],
    rules: {
      "i18next/no-literal-string": [
        2,
        {
          // Real UI copy stays checked (jsx-text-only mode, the plugin's
          // default) -- these are non-textual attribute values / literal
          // brand names, not translatable content (Story 1.10). Options are
          // shallow-merged over the plugin's defaults (lib/options/defaults.js),
          // so the default jsx-attributes excludes are repeated here rather
          // than lost.
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
            exclude: [
              "[0-9!-/:-@[-`{-~]+",
              "[A-Z_-]+",
              "^GymOS$",
              "^·$",
            ],
          },
        },
      ],
    },
  },
];

export default eslintConfig;
