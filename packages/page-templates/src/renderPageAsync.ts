// The same pipeline with react-dom/server loaded lazily. In a Next route handler (the "react-server" layer) a static import of react-dom/server is
// refused at build time; the lazy import is resolved by Node at run time and is the real renderer. Verified against a real `next build` and server.
import { renderPageWith, type RenderPageInput, type RenderPageResult } from "./renderCore";

export async function renderPageAsync(input: RenderPageInput): Promise<RenderPageResult> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderPageWith(renderToStaticMarkup, input);
}
