/**
 * A post-sign-in redirect target comes from an untrusted query param (`?next=`). Only a path that starts with a single "/" followed by
 * a character that is neither "/" nor "\" is kept, and any control character (U+0000-U+001F, U+007F) rejects it: browsers strip tabs,
 * CR and LF from URLs, so "/\t/evil.com" would become "//evil.com". Anything else is "/".
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  if (!/^\/(?![/\\])/.test(next)) return "/";
  return next;
}
