// A real member check-in through the real check_in() RPC (the same path as a QR scan), as phone member A or B. Marks the member dirty; the
// next app open settles it (this is how the 7th, 30th and 100th visit celebration is triggered).  `out` closes the open visit.
//   node scripts/epic30-31-qa/checkin.mjs [A|B] [out]
import { memberByPhone, must, summary } from "./lib.mjs";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
const letter = (args.find((a) => /^[AB]$/i.test(a)) ?? "A").toUpperCase();
const m = await memberByPhone(letter);
if (args.includes("out")) { console.log("check_out:", JSON.stringify(must(await m.client.rpc("check_out"), "check_out"))); }
else { console.log("check_in:", JSON.stringify(must(await m.client.rpc("check_in", { p_scanned_at: new Date().toISOString(), p_client_scan_id: randomUUID() }), "check_in"))); }
console.log("Now open (or foreground) the app on the phone: the first open settles and shows the celebration if a milestone was reached.");
console.table(await summary(m.client));
