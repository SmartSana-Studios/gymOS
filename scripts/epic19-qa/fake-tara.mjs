// Fake Tara Money for LOCAL QA. Implements the three provider endpoints the payment-webhook
// edge function calls (mobilepay, transactions/status) and fires real, shared-secret-signed
// webhook deliveries at the LOCAL payment-webhook function on demand.
//
//   node scripts/epic19-qa/fake-tara.mjs            # listen on :4010 (0.0.0.0, the edge runtime reaches it)
//   FAKE_TARA_PORT=4011 node ...                    # other port
// Control (what tara.mjs and run.mjs use):
//   GET  /txns                                      -> every initiated transaction
//   POST /fire {productId?, outcome, businessId?, secret?, paymentId?, amount?}
//        productId omitted -> the latest transaction. outcome: success | failed.
import http from "node:http";
import { fileURLToPath } from "node:url";
import { FAKE_TARA_PORT, TARA, WEBHOOK_URL } from "./constants.mjs";

export function startFakeTara({ port = FAKE_TARA_PORT, anonKey = "" } = {}) {
  const txns = []; // {transactionId, productId, amount, phone, outcome, firedAt}
  const readJson = (req) => new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  async function fire({ productId, outcome = "success", businessId, secret, paymentId, amount }) {
    const t = productId ? txns.find((x) => x.productId === productId) : txns[txns.length - 1];
    if (!t && !paymentId) return { error: "no transaction to fire for" };
    const ok = outcome === "success";
    // What the provider status check will answer. Only a genuine delivery (own account + own secret)
    // changes it: a wrong-account or forged callback must leave the payment looking pending.
    if (t && !businessId && !secret) t.outcome = ok ? "SUCCESS" : "FAILURE";
    const payload = {
      businessId: businessId ?? TARA.businessId,
      paymentId: paymentId ?? t.transactionId,
      productId: t?.productId ?? "unknown",
      status: ok ? "SUCCESS" : "FAILURE",
      amount: String(amount ?? t?.amount ?? 0),
      originalAmount: String(Math.round((amount ?? t?.amount ?? 0) * 0.98)),
      mobileOperator: "MTN",
    };
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "tara-webhook-secret": secret ?? TARA.webhookSecret, ...(anonKey ? { apikey: anonKey } : {}) },
      body: JSON.stringify(payload),
    });
    if (t) t.firedAt = new Date().toISOString();
    return { webhookStatus: r.status, payload };
  }

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      if (req.method === "GET" && path === "/txns") return send(res, 200, txns);
      if (req.method === "GET" && path === "/") {
        const row = (t, i) => `<li><b>${t.amount} XAF</b> +${t.phone} <code>${String(t.productId).slice(0, 8)}</code> <i>${t.outcome}</i>${
          t.outcome === "PENDING" ? ` <button onclick="go(${i},'success')">Approve</button> <button onclick="go(${i},'failed')">Decline</button>` : ""}</li>`;
        const pending = txns.map((t, i) => [t, i]).filter(([t]) => t.outcome === "PENDING").reverse().map(([t, i]) => row(t, i)).join("");
        const done = txns.map((t, i) => [t, i]).filter(([t]) => t.outcome !== "PENDING").reverse().map(([t, i]) => row(t, i)).join("");
        const li = pending;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta http-equiv=refresh content=3><title>Fake Tara</title>
<body style="font:16px system-ui;max-width:640px;margin:2rem auto;padding:0 1rem"><h1>Fake Tara (local QA)</h1>
<p>Payments the app has started. Approve = the member confirmed on their phone; Decline = refused/failed.</p>
<h3>Waiting for approval</h3><ul>${pending || "<li>nothing pending — start a payment in the app, then refresh</li>"}</ul><details><summary>Already finished (${txns.length - txns.filter((t) => t.outcome === "PENDING").length})</summary><ul>${done}</ul></details><p><a href="/">refresh</a></p>
<script>async function go(i,o){const t=await (await fetch('/txns')).json();
const r=await fetch('/fire',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:t[i].productId,outcome:o})});
alert('webhook answered '+(await r.json()).webhookStatus);location.reload()}</script></body>`);
      }
      const body = req.method === "POST" ? await readJson(req) : {};
      if (path === "/api/tara/mobilepay") {
        const t = { transactionId: `FAKE-${Date.now()}-${txns.length + 1}`, productId: body.productId, amount: body.productPrice, phone: body.phoneNumber, outcome: "PENDING" };
        txns.push(t);
        console.log(`[fake-tara] mobilepay ${t.productId} ${t.amount} XAF -> ${t.transactionId}`);
        return send(res, 200, { status: "SUCCESS", message: "API_ORDER_SUCESSFULL", transactionId: t.transactionId, ussdCode: "#150*50#" });
      }
      if (path === "/api/tara/transactions/status") {
        const t = txns.find((x) => x.productId === body.productId);
        return send(res, 200, { status: t?.outcome ?? "PENDING", message: "fake" });
      }
      if (path === "/fire") {
        const out = await fire(body);
        console.log(`[fake-tara] fire ${body.outcome ?? "success"} ->`, out.webhookStatus ?? out.error);
        return send(res, out.error ? 404 : 200, out);
      }
      return send(res, 404, { error: "not found", path });
    } catch (e) {
      return send(res, 500, { error: String(e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const envText = readFileSync(resolve(root, "apps/dashboard/.env.local"), "utf8");
  const anonKey = /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.*)$/m.exec(envText)?.[1] ?? "";
  await startFakeTara({ anonKey });
  console.log(`[fake-tara] listening on :${FAKE_TARA_PORT}`);
}
