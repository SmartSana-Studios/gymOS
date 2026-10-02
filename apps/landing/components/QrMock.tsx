/**
 * A decorative QR-style matrix for the hero's scanner panel.
 *
 * Generated from a fixed seed rather than copied from anywhere, and
 * deliberately NOT a real encodable QR code -- it is illustration, labelled
 * as such in its alt text. Rendering a genuine scannable code here would
 * invite someone to point a phone at the marketing page, which resolves to
 * nothing useful.
 *
 * Deterministic so the server and client render identical markup; a random
 * matrix would hydrate-mismatch on every load.
 */
const SIZE = 29;
const FINDER_ORIGINS = [
  [0, 0],
  [SIZE - 7, 0],
  [0, SIZE - 7],
] as const;

function isFinderArea(x: number, y: number): boolean {
  return FINDER_ORIGINS.some(
    ([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7,
  );
}

/** Small deterministic hash -> [0,1). Any stable function would do; this one
 *  just needs to look unstructured at module scale. */
function noise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function QrMock({ title }: { title: string }) {
  const modules: { x: number; y: number }[] = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (isFinderArea(x, y)) continue;
      if (noise(x, y) > 0.52) modules.push({ x, y });
    }
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={title} className="block h-auto w-full">
      <g fill="#0a121f">
        {FINDER_ORIGINS.map(([fx, fy]) => (
          <g key={`${fx}-${fy}`}>
            <path
              fillRule="evenodd"
              d={`M${fx} ${fy}h7v7h-7V${fy}zm1 1v5h5v-5h-5z`}
            />
            <rect x={fx + 2} y={fy + 2} width="3" height="3" />
          </g>
        ))}
        {modules.map(({ x, y }) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
        ))}
      </g>
    </svg>
  );
}
