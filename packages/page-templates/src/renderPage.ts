// Synchronous binding of the render pipeline to react-dom/server: for tests, the conformance suite and plain Node. Next's server layer refuses
// a static import of react-dom/server, so apps/landing uses renderPageAsync.ts instead.
import { renderToStaticMarkup } from "react-dom/server";
import { renderPageWith, type RenderPageInput, type RenderPageResult } from "./renderCore";

export { schemeFor, DEFAULT_MEDIA_PATH, type RenderPageInput, type RenderPageResult } from "./renderCore";

export function renderPage(input: RenderPageInput): RenderPageResult {
  return renderPageWith(renderToStaticMarkup, input);
}
