/**
 * Photography for the marketing page, served from Unsplash's CDN.
 *
 * Unsplash's licence permits commercial use without attribution, and the
 * reference site this page is modelled on sources its imagery the same way.
 * Kept here as bare photo ids with one `src()` helper rather than as full
 * URLs scattered through components, so the width/quality/crop parameters
 * are set in one place and a swapped photo is a one-line change.
 *
 * Alt text lives in lib/copy.ts, not here, because it is prose and has to
 * exist in both languages.
 *
 * Deliberately NOT used anywhere: a photo of a person presented as a GymOS
 * customer. These are gym environments and training, which is what stock
 * photography honestly is. The two faces that do appear sit inside the
 * hero's mock check-in panel, which reads as product UI -- the same way a
 * dashboard screenshot carries sample names.
 */
const PHOTOS = {
  heroGym: "photo-1571019613454-1cb2f99b2d8b",
  checkin: "photo-1534438327276-14e5300c3a48",
  members: "photo-1517836357463-d25dfeac3438",
  insights: "photo-1540497077202-7c8a3999166f",
  about: "photo-1550345332-09e3ac987658",
  coaching: "photo-1593079831268-3381b0db4a77",
  memberA: "photo-1534528741775-53994a69daeb",
  memberB: "photo-1568602471122-7832951cc4c5",
} as const;

export type PhotoKey = keyof typeof PHOTOS;

export function photo(key: PhotoKey, width: number, quality = 70): string {
  return `https://images.unsplash.com/${PHOTOS[key]}?auto=format&fit=crop&w=${width}&q=${quality}`;
}
