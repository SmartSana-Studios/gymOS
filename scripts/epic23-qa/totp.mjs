// Prints the current authenticator code for a QA account (the seed stores each secret in .state.json).
//   node scripts/epic23-qa/totp.mjs                 # every account
//   node scripts/epic23-qa/totp.mjs qa23-active     # one (substring match)
import { readState, totp } from "./lib.mjs";

const { secrets = {} } = readState();
const q = process.argv[2];
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const [who, secret] of Object.entries(secrets)) {
  if (q && !who.includes(q)) continue;
  console.log(`${who.padEnd(34)} ${totp(secret)}   (${left}s left)`);
}
if (!Object.keys(secrets).length) console.log("no secrets yet: run seed.mjs");
