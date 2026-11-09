import nextTypescript from "eslint-config-next/typescript";

// Story 24.10 (AD-48): templates are pure modules and gym text is a React text node, never markup. These two rules are enforced here and in
// apps/landing: no dangerouslySetInnerHTML anywhere, and no database, network, fs or Supabase import in a template or its helpers.
const eslintConfig = [
  ...nextTypescript,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Gym text is rendered as React text nodes only; dangerouslySetInnerHTML is forbidden (AD-48).",
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: "Gym text is rendered as React text nodes only; dangerouslySetInnerHTML is forbidden (AD-48).",
        },
      ],
    },
  },
  {
    // Template modules and their helpers: pure. (headers.ts and renderPage.ts are the pipeline and may use node:crypto and react-dom/server.)
    files: ["src/templates/**", "src/chrome.ts", "src/contract.ts", "src/format.ts", "src/colors.ts", "src/language.ts"],
    ignores: ["**/*.test.*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["pg", "pg/*", "fs", "fs/*", "node:*", "net", "http", "https", "child_process", "undici", "axios", "@supabase/*"], message: "A template imports no database, network, fs or Supabase module (AD-48)." },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "XMLHttpRequest", "process"],
    },
  },
  { ignores: ["node_modules/**"] },
];

export default eslintConfig;
