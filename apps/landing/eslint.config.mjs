import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

// Same flat-config import style as apps/dashboard (see that file's comment
// for why `FlatCompat.extends` is avoided here).
//
// `i18next/no-literal-string` matters more on this app than anywhere else in
// the repo: every word on this page is marketing copy that must exist in
// both English and French, and the one failure mode that actually ships is a
// developer typing a sentence straight into JSX, where the French reader
// then sees it in English. The rule makes that a lint error rather than
// something a reviewer has to notice. All copy belongs in lib/copy.ts.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ...i18next.configs["flat/recommended"],
    rules: {
      "i18next/no-literal-string": [
        2,
        {
          words: {
            exclude: [
              "[0-9!-/:-@[-`{-~]+",
              "[A-Z_-]+",
              "^GymOS$",
              "^·$",
              "^—$",
              /^\p{Emoji}+$/u,
            ],
          },
        },
      ],
    },
  },
];

export default eslintConfig;
