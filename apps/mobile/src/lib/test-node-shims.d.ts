// The mobile app has no @types/node. The source-scan test (weeklyRing.source.test.ts) reads files in Vitest's node environment; these declare the two
// calls it uses, and nothing the app bundles imports them.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
