/**
 * Public store listings of the member app, put in the member invite message. Same two listings as the landing
 * site (apps/landing/lib/config.ts); hardcoded defaults because they are facts about published listings, overridable
 * per environment.
 */
export const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL ?? "https://apps.apple.com/app/id6798403711";
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? "https://play.google.com/store/apps/details?id=com.smartsana.gymos";
