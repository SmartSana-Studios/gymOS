// Drive the fake Tara from the terminal (LOCAL QA). The fake provider must be running
// (fake-tara.mjs, or start-mobile.sh which starts it).
//   node scripts/epic19-qa/tara.mjs list               pending/finished fake transactions
//   node scripts/epic19-qa/tara.mjs success [n]        approve the latest (or the n-th) transaction
//   node scripts/epic19-qa/tara.mjs failed  [n]        decline it
//   node scripts/epic19-qa/tara.mjs wrong   [n]        deliver it from ANOTHER gym's Tara account (must be refused)
//   node scripts/epic19-qa/tara.mjs forged  [n]        deliver it with a bad secret (must 401)
import { FAKE_TARA_URL, OTHER_TARA } from "./constants.mjs";
const [cmd = "list", idx] = process.argv.slice(2);
const txns = await (await fetch(`${FAKE_TARA_URL}/txns`)).json();
if (cmd === "list") { console.table(txns.map((t, i) => ({ n: i, productId: t.productId, amount: t.amount, phone: t.phone, outcome: t.outcome, firedAt: t.firedAt ?? "" }))); process.exit(0); }
const t = idx === undefined ? txns[txns.length - 1] : txns[Number(idx)];
if (!t) { console.error("no such transaction -- start a payment in the app first (tara.mjs list)"); process.exit(1); }
const body = { productId: t.productId, outcome: cmd === "failed" ? "failed" : "success" };
if (cmd === "wrong") Object.assign(body, { businessId: OTHER_TARA.businessId, secret: OTHER_TARA.webhookSecret });
if (cmd === "forged") body.secret = "not-the-secret";
const r = await (await fetch(`${FAKE_TARA_URL}/fire`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
console.log(`${cmd} -> payment ${t.productId}: webhook answered ${r.webhookStatus}`);
