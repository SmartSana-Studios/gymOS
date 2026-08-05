const HEX_COLOR_RE = /^#([0-9A-Fa-f]{6})$/;

/** Picks readable black or white label text for an arbitrary background hex
 * color (YIQ perceived-brightness formula) -- needed because `accent` can be
 * a gym owner's freely-chosen `primary_color` (apps/dashboard's Settings
 * form only hex-validates it, no contrast check), unlike the platform's own
 * fixed, designed-for-black-text `Brand.accent`. */
export function getContrastTextColor(backgroundColor: string): '#000000' | '#FFFFFF' {
  const match = HEX_COLOR_RE.exec(backgroundColor);
  if (!match) return '#000000';

  const hex = match[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  return yiq >= 128 ? '#000000' : '#FFFFFF';
}
