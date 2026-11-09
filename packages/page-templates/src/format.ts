// Story 24.10: pure formatting helpers shared by templates. No gym text is turned into markup here: every function returns a string that a
// template renders as a React text node or as an attribute value, and every URL is built from validated parts (E.164 digits, numbers).
import type { PageContentLanguage } from "@gymos/types";

const NBSP = " ";

/** A price as stored with its own currency code, grouped by the language shown: "15 000 XAF" in French, "15,000 XAF" in English. Never converted. */
export function formatPrice(amount: number, currency: string, lang: PageContentLanguage): string {
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(amount)}${NBSP}${currency}`;
}

/** Digits only of an E.164 number (no plus). */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

export const telHref = (e164: string): string => `tel:+${phoneDigits(e164)}`;
export const whatsappHref = (e164: string): string => `https://wa.me/${phoneDigits(e164)}`;

function coord(n: number): string {
  return n.toFixed(6);
}

/** Google Maps directions to the stored position. The provider is the platform default (EXPERIENCE.md contact actions, [ASSUMPTION]). */
export function directionsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(lat)},${coord(lng)}`;
}

/** Google Maps pin at the stored position ("Open the map"). */
export function mapHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(lat)},${coord(lng)}`;
}

/** The country's name in the language shown, from its ISO code; the code itself when the runtime does not know it. */
export function countryName(code: string, lang: PageContentLanguage): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Paragraphs of a plain text: one per non-empty line (line breaks are preserved as paragraphs). */
export function paragraphs(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/** Items of a Services text: one per non-empty line. */
export function lines(text: string): string[] {
  return paragraphs(text);
}

/** At most `max` characters of the first paragraph, cut at a word, for the meta description. */
export function excerpt(text: string, max = 160): string {
  const first = paragraphs(text)[0] ?? "";
  const chars = Array.from(first);
  if (chars.length <= max) return first;
  const cut = chars.slice(0, max).join("");
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
