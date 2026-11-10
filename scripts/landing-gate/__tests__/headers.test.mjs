// Story 24.12: the AD-44 header check is shown failing. Unit level (checkResponse / diffResponses on doctored responses) and end to end:
// check-http.mjs run as a process against a small doctored HTTP server, one doctoring per run.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CACHE_CONTROL, SECURITY_BASE, checkResponse, diffResponses, expectedCsp, singleStyleBlock, styleHash } from "../lib/headers.mjs";

const MEDIA = "http://127.0.0.1:3911";
const STYLE = "body{margin:0}";
const html = (extra = "") => `<!doctype html><html lang="en"><head><style>${STYLE}</style></head><body>GATE FIT${extra}</body></html>`;

function pageHeaders(over = {}) {
  const h = {
    "content-type": ["text/html; charset=utf-8"],
    "cache-control": [CACHE_CONTROL.page],
    "x-content-type-options": [SECURITY_BASE["x-content-type-options"]],
    "referrer-policy": [SECURITY_BASE["referrer-policy"]],
    "strict-transport-security": [SECURITY_BASE["strict-transport-security"]],
    "content-security-policy": [expectedCsp(MEDIA, styleHash(STYLE))],
    vary: ["rsc, next-router-state-tree, Accept-Language"],
    "x-middleware-rewrite": ["/gym-site"],
    date: ["now"],
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete h[k];
    else h[k] = [].concat(v);
  }
  return h;
}
const page = (over, body = html()) => ({ status: 200, headers: pageHeaders(over), body: Buffer.from(body) });
const problems = (res, kind = "page", ctx = {}) => checkResponse(kind, res, { mediaOrigin: MEDIA, ...ctx }).problems;

test("a correct page passes and the Next-added headers are reported, not failed", () => {
  const r = checkResponse("page", page(), { mediaOrigin: MEDIA });
  assert.deepEqual(r.problems, []);
  assert.ok(r.nextAdded.includes("x-middleware-rewrite: /gym-site"));
  assert.ok(r.nextAdded.includes("vary: rsc"));
});
test("known bad: every AD-44 header, dropped or altered, fails and names the header", () => {
  for (const name of ["x-content-type-options", "referrer-policy", "strict-transport-security", "content-security-policy", "cache-control", "content-type"]) {
    assert.ok(problems(page({ [name]: null })).some((p) => p.includes(`missing header ${name}`)), `dropping ${name}`);
    assert.ok(problems(page({ [name]: "x" })).some((p) => p.includes(name)), `altering ${name}`);
  }
});
test("known bad: a one-token change to the CSP fails", () => {
  const csp = expectedCsp(MEDIA, styleHash(STYLE)).replace("script-src 'none'", "script-src 'self'");
  assert.ok(problems(page({ "content-security-policy": csp })).some((p) => p.includes("content-security-policy")));
  const wrongHash = expectedCsp(MEDIA, styleHash("other{}"));
  assert.ok(problems(page({ "content-security-policy": wrongHash })).some((p) => p.includes("content-security-policy")));
});
test("known bad: a cookie, an unexpected header, a second inline style, a wrong status, a stray Vary token", () => {
  assert.ok(problems(page({ "set-cookie": "a=b" })).some((p) => p.includes("sets a cookie")));
  assert.ok(problems(page({ "x-powered-by": "Next.js" })).some((p) => p.includes("unexpected header x-powered-by")));
  assert.ok(problems(page({}, html("<style>a{}</style>"))).some((p) => p.includes("exactly one <style>")));
  assert.ok(problems({ ...page(), status: 500 }).some((p) => p.includes("status 500")));
  assert.ok(problems(page({ vary: "rsc, Cookie, Accept-Language" })).some((p) => p.includes("unexpected Vary token [cookie]")));
  assert.ok(problems(page({ vary: "rsc" })).some((p) => p.includes("Vary lacks Accept-Language")));
  assert.ok(problems(page({ "x-middleware-rewrite": "/elsewhere" })).some((p) => p.includes("x-middleware-rewrite")));
});
test("a platform header is allowed only when the platform is named, and then it is listed", () => {
  const withVercel = page({ server: "Vercel", "x-vercel-id": "fra1::abc" });
  assert.ok(problems(withVercel).some((p) => p.includes("unexpected header server")));
  const r = checkResponse("page", withVercel, { mediaOrigin: MEDIA, platform: "vercel" });
  assert.deepEqual(r.problems, []);
  assert.equal(r.platformExtras.length, 2);
  assert.deepEqual(checkResponse("page", page({ "x-edge": "1" }), { mediaOrigin: MEDIA, extraAllowed: ["x-edge"] }).problems, []);
});
test("the not-found and redirect kinds have their own exact sets", () => {
  const nf = (over = {}, body = html()) => {
    const h = pageHeaders({ "cache-control": CACHE_CONTROL.notFound, vary: "rsc, next-router-state-tree", "content-security-policy": expectedCsp("'none'", styleHash(STYLE)), ...over });
    return { status: 404, headers: h, body: Buffer.from(body) };
  };
  assert.deepEqual(problems(nf(), "notFound"), []);
  assert.ok(problems(nf({ vary: "rsc, Accept-Language" }), "notFound").some((p) => p.includes("Vary carries Accept-Language")));
  assert.ok(problems(nf({ "content-security-policy": expectedCsp(MEDIA, styleHash(STYLE)) }), "notFound").some((p) => p.includes("content-security-policy")));
  const redirect = (over = {}, body = "") => ({
    status: 301,
    headers: { location: ["http://fit.localhost/"], "cache-control": [CACHE_CONTROL.redirect], "x-content-type-options": ["nosniff"], "strict-transport-security": [SECURITY_BASE["strict-transport-security"]], vary: ["rsc"], "x-middleware-rewrite": ["/gym-site"], ...over },
    body: Buffer.from(body),
  });
  assert.deepEqual(problems(redirect(), "redirect", { location: "http://fit.localhost/" }), []);
  assert.ok(problems(redirect({ location: ["http://evil.example/"] }), "redirect", { location: "http://fit.localhost/" }).some((p) => p.includes("location")));
  assert.ok(problems(redirect({ "cache-control": ["no-store"] }), "redirect").some((p) => p.includes("cache-control")));
  assert.ok(problems(redirect({ "set-cookie": ["a=b"] }), "redirect").some((p) => p.includes("cookie")));
  assert.ok(problems({ ...redirect({}, "body"), status: 302 }, "redirect").length >= 2);
});

test("diffResponses: identical but for Date; any other difference is named", () => {
  const a = { status: 404, headers: { date: ["a"], vary: ["rsc"], "cache-control": ["x"] }, body: Buffer.from("same") };
  const b = { status: 404, headers: { date: ["b"], vary: ["rsc"], "cache-control": ["x"] }, body: Buffer.from("same") };
  assert.deepEqual(diffResponses(a, b), []);
  assert.deepEqual(diffResponses(a, { ...b, status: 410 }), ["status 404 vs 410"]);
  assert.match(diffResponses(a, { ...b, headers: { ...b.headers, vary: ["rsc, accept-language"] } })[0], /header vary/);
  assert.match(diffResponses(a, { ...b, headers: { ...b.headers, "x-extra": ["1"] } })[0], /header x-extra: \[absent\]/);
  assert.match(diffResponses(a, { ...b, body: Buffer.from("samf") })[0], /body differs/);
});
test("diffResponses: per-request platform headers are ignored only when a platform is named, any other difference still fails", () => {
  const base = { status: 404, headers: { date: ["a"], vary: ["rsc"], "x-vercel-id": ["fra1::a"], "x-vercel-cache": ["MISS"], age: ["0"], "cf-ray": ["1"], "server-timing": ["x;dur=1"] }, body: Buffer.from("same") };
  const other = { ...base, headers: { ...base.headers, "x-vercel-id": ["fra1::b"], "x-vercel-cache": ["HIT"], age: ["9"], "cf-ray": ["2"], "server-timing": ["x;dur=2"] } };
  assert.ok(diffResponses(base, other).length >= 4, "with no platform the per-request headers are differences");
  assert.deepEqual(diffResponses(base, other, { platform: "vercel" }), []);
  assert.match(diffResponses(base, { ...other, headers: { ...other.headers, vary: ["rsc, accept-language"] } }, { platform: "vercel" })[0], /header vary/);
  assert.match(diffResponses(base, { ...other, body: Buffer.from("diff") }, { platform: "vercel" })[0], /body differs/);
});
test("singleStyleBlock", () => {
  assert.equal(singleStyleBlock("<style>a{}</style>"), "a{}");
  assert.equal(singleStyleBlock("<style>a{}</style><style>b{}</style>"), null);
  assert.equal(singleStyleBlock("no style"), null);
});

// ---- end to end: check-http.mjs against a doctored server ----
const SCRIPT = fileURLToPath(new URL("../check-http.mjs", import.meta.url));

/** A server that behaves like the landing server; `doctor(label, response)` may break one response. */
function startServer(doctor = () => undefined) {
  const server = http.createServer((req, res) => {
    const label = (req.headers.host ?? "").split(".")[0];
    let r;
    if (label === "gate-grace") r = { status: 200, headers: pageHeaders(), body: html() };
    else if (label === "gate-grace-old") r = { status: 301, headers: { location: ["http://gate-grace.localhost/"], "cache-control": [CACHE_CONTROL.redirect], "x-content-type-options": ["nosniff"], "strict-transport-security": [SECURITY_BASE["strict-transport-security"]], vary: ["rsc"], "x-middleware-rewrite": ["/gym-site"] }, body: "" };
    else r = { status: 404, headers: pageHeaders({ "cache-control": CACHE_CONTROL.notFound, vary: "rsc, next-router-state-tree", "content-security-policy": expectedCsp("'none'", styleHash(STYLE)) }), body: html("-NF") };
    r = structuredClone(r);
    doctor(label, r);
    const raw = [];
    for (const [k, v] of Object.entries(r.headers)) for (const x of v) raw.push([k, x]);
    res.writeHead(r.status, raw);
    res.end(r.body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}
function runCheck(port, extraEnv = {}, rawEnv = false) {
  return new Promise((resolve) => {
    const base = rawEnv ? { ...process.env } : { ...process.env, BASE_URL: `http://127.0.0.1:${port}`, ROOT_DOMAIN: "localhost", GATE_MEDIA_ORIGIN: MEDIA, GATE_LABEL_SUSPENDED: "", GATE_LABEL_INVALID: "" };
    const p = spawn(process.execPath, [SCRIPT], { env: { ...base, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}
async function withServer(doctor, fn) {
  const { server, port } = await startServer(doctor);
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

test("check-http passes against a faithful server", async () => {
  await withServer(undefined, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 0, out);
    assert.match(out, /check-http: PASS/);
  });
});
test("check-http fails (exit 1) when the page drops a header, naming it", async () => {
  await withServer((label, r) => { if (label === "gate-grace") delete r.headers["strict-transport-security"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: missing header strict-transport-security/);
  });
});
test("check-http fails when a not-found adds a header", async () => {
  await withServer((label, r) => { if (label === "gate-nobody-here") r.headers["x-debug"] = ["1"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /unexpected header x-debug/);
  });
});
test("check-http fails when a redirect lands somewhere that is not the page", async () => {
  await withServer((label, r) => { if (label === "gate-grace-old") r.headers.location = ["http://elsewhere.localhost/"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /location/);
  });
});
test("check-http fails when one hidden cause answers differently from the others (a cause that leaks)", async () => {
  await withServer((label, r) => { if (label === "gate-down") { r.body = html("-TAKEN-DOWN"); } }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /not-found differs, unknown vs taken down: body differs/);
  });
  await withServer((label, r) => { if (label === "gate-draft") r.headers["cache-control"] = ["public, s-maxage=31"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /not-found differs, unknown vs unpublished: header cache-control/);
  });
});
test("check-http reads the body marker from GATE_PUBLISHED_MARKER", async () => {
  await withServer(undefined, async (port) => {
    const { code, out } = await runCheck(port, { GATE_PUBLISHED_MARKER: "NOT ON THE PAGE" });
    assert.equal(code, 1);
    assert.match(out, /does not carry the marker "NOT ON THE PAGE"/);
  });
});
test("check-http in {label} mode fails with a clear message when the redirect, unpublished and taken-down labels are unset", async () => {
  const { code, out } = await runCheck(1, { BASE_URL: "http://{label}.localhost:1", GATE_LABEL_PUBLISHED: "x-pub", GATE_LABEL_REDIRECT_OLD: "", GATE_LABEL_UNPUBLISHED: "", GATE_LABEL_TAKEN_DOWN: "" }, true);
  assert.equal(code, 1);
  assert.match(out, /set GATE_LABEL_REDIRECT_OLD, GATE_LABEL_UNPUBLISHED, GATE_LABEL_TAKEN_DOWN/);
});
test("check-http fails when the server is not there", async () => {
  const { code, out } = await runCheck(1);
  assert.equal(code, 1);
  assert.match(out, /could not complete/);
});
