// Story 19.11: the platform-fixed `info` status token (blue). Used only for
// recoverable action-required or pending states, always with a label and an
// icon; never `danger`, and never overridden by the gym accent color.
export const INFO_STATUS = {
  /** Solid full-screen overlay background (white text on top). */
  solid: '#1D4ED8',
  bg: '#122A3A',
  border: '#1F4D6B',
  text: '#60A5FA',
} as const;
