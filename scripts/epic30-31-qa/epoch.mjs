// Turn the engagement area dark (epoch NULL: Home and Profile exactly as before the epics) or back on.
//   node scripts/epic30-31-qa/epoch.mjs off|on
import { setEpoch, epochMonday } from "./lib.mjs";
const v = process.argv[2];
if (v === "off") { setEpoch(null); console.log("epoch = NULL: dark. Pull to refresh Home on the phone."); }
else if (v === "on") { setEpoch(epochMonday()); console.log(`epoch = ${epochMonday()}: on.`); }
else { console.error("usage: epoch.mjs off|on"); process.exit(1); }
