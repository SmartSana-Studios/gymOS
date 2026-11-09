// Story 24.10 (EXPERIENCE.md "On-gym color"): the SERVER computes the text colour on the gym colour, not the browser and not the template.
// White or ink, whichever reaches 4.5:1 on the gym colour; when neither does (a mid-tone), the main action takes the platform accent with
// ink text instead. WCAG 2.1 relative luminance and contrast ratio.
import type { GymColors } from "./contract";

export const INK = "#1B2A41";
export const WHITE = "#FFFFFF";
/** DESIGN.md `colors.accent`: the platform accent, the fill when the gym has no colour or no usable pairing. */
export const PLATFORM_ACCENT = "#E0971F";
/** The Classic page background, which a non-text gym-coloured element may sit on. */
export const CLASSIC_PAGE_BACKGROUND = "#F3F4F0";

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colours a template receives. `primary` is the snapshot's `color` (`#rrggbb`) or undefined. */
export function computeGymColors(primary: string | undefined): GymColors {
  const gym = primary && parseHex(primary) ? primary.toUpperCase() : PLATFORM_ACCENT;
  const onWhite = contrast(gym, WHITE);
  const onInk = contrast(gym, INK);
  const ui = contrast(gym, WHITE) >= 3 && contrast(gym, CLASSIC_PAGE_BACKGROUND) >= 3 ? gym : INK;
  if (onWhite >= 4.5 || onInk >= 4.5) {
    return { gym, ui, fill: gym, on: onWhite >= onInk ? WHITE : INK };
  }
  return { gym, ui, fill: PLATFORM_ACCENT, on: INK };
}
