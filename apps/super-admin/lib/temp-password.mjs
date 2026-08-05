// Extracted from app/(admin)/gyms/actions.ts (Story 1.5) so Story 1.12's
// scripts/provision-super-admin.mjs CLI script can reuse the exact same
// generator instead of duplicating it a second time in this app. Plain JS
// (not .ts) deliberately -- the CLI script is run directly by `node` with no
// build step, and Node's ESM loader cannot import .ts files unflagged; a
// plain .mjs is importable by both this Next.js app (allowJs, tsconfig.json)
// and the CLI script (explicit ".mjs" extension, required by Node's ESM
// resolver for relative imports).

// Fixed unambiguous alphabet -- excludes 0/O/1/l/I (visually confusable when
// read off a screen or heard over the phone). Length 10 comfortably clears
// config.toml's minimum_password_length = 6; this is a forced-change temp
// credential (must_change_password gate), not a long-lived secret, so simple
// rejection-sampling (below) is sufficient rigor.
const TEMP_PASSWORD_ALPHABET =
  "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TEMP_PASSWORD_LENGTH = 10;

export function generateTempPassword() {
  const maxValidByte =
    Math.floor(256 / TEMP_PASSWORD_ALPHABET.length) * TEMP_PASSWORD_ALPHABET.length;
  let password = "";
  while (password.length < TEMP_PASSWORD_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(TEMP_PASSWORD_LENGTH));
    for (const byte of bytes) {
      if (password.length >= TEMP_PASSWORD_LENGTH) break;
      // Reject bytes past the last full multiple of the alphabet's length --
      // avoids the modulo-bias a plain `byte % alphabet.length` would introduce.
      if (byte < maxValidByte) password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
    }
  }
  return password;
}
