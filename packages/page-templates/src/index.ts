// @gymos/page-templates: the public surface. Templates themselves live under ./templates and export `render` only; this index exports the
// registry, the contract types and the render pipeline the landing app calls.
export * from "./contract";
export { CHROME } from "./chrome";
export { REGISTERED_TEMPLATES, assertRegistrable, getTemplate } from "./registry";
export { renderPageWith, schemeFor, DEFAULT_MEDIA_PATH, type MarkupRenderer, type RenderPageInput, type RenderPageResult } from "./renderCore";
export { renderPageAsync } from "./renderPageAsync";
export { classifyPagePath, decideLanguage, languageOrder, parseAcceptLanguage, type LanguageDecision, type PagePath } from "./language";
export { computeGymColors, contrast, luminance, INK, WHITE, PLATFORM_ACCENT, CLASSIC_PAGE_BACKGROUND } from "./colors";
export {
  NOT_FOUND_CACHE_CONTROL,
  PAGE_CACHE_CONTROL,
  REDIRECT_CACHE_CONTROL,
  SECURITY_HEADERS_BASE,
  contentSecurityPolicy,
  extractStyleBlock,
  styleHash,
} from "./headers";
export { formatPrice } from "./format";
