// Per-app copy of apps/super-admin/lib/temp-password.mjs's generateTempPassword()
// -- same alphabet, same rejection-sampling algorithm. Plain .ts, not .mjs:
// the super-admin version is .mjs only because Story 1.12's CLI script
// (provision-super-admin.mjs) needs a no-build-step Node ESM import, a
// constraint that doesn't exist in apps/dashboard. Matches this codebase's
// established no-shared-code-across-apps discipline (services aren't shared
// across apps either, per AD-7).

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
