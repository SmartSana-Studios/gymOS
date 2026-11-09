// Drawn icons (1.75 px stroke, no emoji, no icon font). Decorative: the label next to each is the accessible name.
export function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 8 19.6L3 21z" />
      <path d="M9 9c0 3 2.5 6 6 6l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2L9 9z" />
    </svg>
  );
}

export function DirectionsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 11l18-8-8 18-2-8-8-2z" />
    </svg>
  );
}

/** A drawn map tile with a pin: no map image, no third-party tiles. */
export function MapTile() {
  return (
    <svg className="map" viewBox="0 0 200 100" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="100" fill="#E4E8DE" />
      <path d="M0 70 L80 55 L130 80 L200 40" fill="none" stroke="#FFFFFF" strokeWidth="8" />
      <path d="M60 0 L75 100" fill="none" stroke="#FFFFFF" strokeWidth="5" />
      <path d="M140 0 L120 100" fill="none" stroke="#FFFFFF" strokeWidth="5" />
      <path className="pin" d="M100 20c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16z" />
      <circle cx="100" cy="36" r="6" fill="#FFFFFF" />
    </svg>
  );
}
