// Probes of the CORE product while a label scan runs (story 24.12: the public site must not hurt the product that pays for it):
//   * the dashboard Overview page load, as a signed-in Owner in headless Chromium (navigation start to the `load` event, Overview heading visible)
//   * the check-in RPC round trip, as a signed-in member, over PostgREST (check_in is timed; the check_out that follows is not)
// Both need a dedicated probe gym and its credentials (GATE_CORE_*; run-local.sh creates one with core-fixture.mjs, staging uses a gym the owner sets aside).
import { loadPlaywright } from "./resolve.mjs";

export function coreEnv(env = process.env) {
  const need = ["GATE_CORE_API_URL", "GATE_CORE_ANON_KEY", "GATE_CORE_DASHBOARD_URL", "GATE_CORE_OWNER_EMAIL", "GATE_CORE_OWNER_PASSWORD", "GATE_CORE_MEMBER_PHONE", "GATE_CORE_MEMBER_PASSWORD"];
  if (need.some((k) => !env[k])) return null;
  return {
    apiUrl: env.GATE_CORE_API_URL,
    anonKey: env.GATE_CORE_ANON_KEY,
    dashboardUrl: env.GATE_CORE_DASHBOARD_URL,
    ownerEmail: env.GATE_CORE_OWNER_EMAIL,
    ownerPassword: env.GATE_CORE_OWNER_PASSWORD,
    memberPhone: env.GATE_CORE_MEMBER_PHONE,
    memberPassword: env.GATE_CORE_MEMBER_PASSWORD,
  };
}

async function memberSession(c) {
  const r = await fetch(`${c.apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: c.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ phone: c.memberPhone.replace(/^\+/, ""), password: c.memberPassword }),
  });
  if (!r.ok) throw new Error(`core probe: member sign-in failed (${r.status})`);
  return (await r.json()).access_token;
}

async function rpc(c, token, name, args = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${c.apiUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: c.anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    const ms = performance.now() - t0;
    const text = await r.text();
    return { ok: r.ok, status: r.status, ms, text };
  } catch (e) {
    // a transport failure is a probe error (the judge compares the error rate with the baseline's), never a dead probe loop
    return { ok: false, status: 0, ms: performance.now() - t0, text: `transport error: ${e.message}` };
  }
}

/** Starts both probes; `stop()` returns the samples (milliseconds) collected since. */
export async function startCoreProbes(c) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  let page;
  let token;
  try {
    page = await context.newPage();
    await page.goto(`${c.dashboardUrl}/auth/login`);
    await page.getByRole("tab", { name: /email|e-mail/i }).click();
    await page.locator("#login-email").fill(c.ownerEmail);
    await page.locator("#password").fill(c.ownerPassword);
    await page.getByRole("button", { name: /sign in|connexion/i }).click();
    await page.waitForURL((u) => !/\/auth\/login/.test(u.pathname), { timeout: 20_000 });
    token = await memberSession(c);
  } catch (e) {
    await browser.close(); // a failed login must not leave Chromium running
    throw e;
  }

  const samples = { overview: [], checkIn: [] };
  const attempts = { overview: 0, checkIn: 0 };
  const errors = [];
  let running = true;

  const overviewLoop = (async () => {
    while (running) {
      const t0 = performance.now();
      attempts.overview++;
      try {
        await page.goto(`${c.dashboardUrl}/`, { waitUntil: "load", timeout: 30_000 });
        await page.getByRole("heading", { name: /overview|aper[cç]u|tableau de bord/i }).first().waitFor({ timeout: 10_000 });
        if (running) samples.overview.push(performance.now() - t0);
      } catch (e) {
        errors.push(`overview: ${e.message.split("\n")[0]}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  const checkInLoop = (async () => {
    while (running) {
      attempts.checkIn++;
      const ci = await rpc(c, token, "check_in");
      if (ci.ok) {
        samples.checkIn.push(ci.ms);
        await rpc(c, token, "check_out"); // untimed: closes the session so the next check-in is a fresh one
      } else {
        errors.push(`check_in: ${ci.status} ${ci.text.slice(0, 120)}`);
        await rpc(c, token, "check_out");
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  })();

  return {
    async stop() {
      running = false;
      await Promise.all([overviewLoop, checkInLoop]);
      await browser.close();
      return { samples, errors, attempts };
    },
  };
}

/** Collects probe samples for a fixed time with nothing else running (the baseline). */
export async function measureBaseline(c, seconds) {
  const p = await startCoreProbes(c);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return p.stop();
}
