// A drawn dark map tile with a pin (no map image, no third-party tiles). The pin takes the accent through CSS (`.pin`).
export function DarkMapTile() {
  return (
    <svg className="map" viewBox="0 0 200 100" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="100" fill="#171B26" />
      <path d="M0 70 L80 55 L130 80 L200 40" fill="none" stroke="#2A3142" strokeWidth="8" />
      <path d="M60 0 L75 100" fill="none" stroke="#2A3142" strokeWidth="5" />
      <path d="M140 0 L120 100" fill="none" stroke="#2A3142" strokeWidth="5" />
      <path className="pin" d="M100 20c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16z" />
      <circle cx="100" cy="36" r="6" fill="#07080D" />
    </svg>
  );
}
