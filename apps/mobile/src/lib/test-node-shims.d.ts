// The mobile app has no @types/node. The source-scan test (weeklyRing.source.test.ts) reads files in Vitest's node environment; these declare the
// calls they use (Story 31.4's engagementGate.test.ts also walks the source tree with statSync and join), and nothing the app bundles imports them.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
