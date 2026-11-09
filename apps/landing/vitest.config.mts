import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// Story 24.10: unit tests for the public gym page route (proxy, handler, reader, uniform not-found). `server-only` throws outside a
// react-server build, so tests alias it to an empty module.
export default defineConfig({
  test: { environment: "node", include: ["**/*.test.ts"], exclude: ["node_modules/**", ".next/**"] },
  resolve: { alias: { "@": dirname, "server-only": fileURLToPath(new URL("./test-stubs/server-only.ts", import.meta.url)) } },
});
