// A raw HTTP/1.1 GET that keeps what a browser hides: header names as the server wrote them, repeated headers, the unfollowed redirect, the
// exact body bytes. Node's fetch decompresses, follows redirects and merges headers; this does none of that. `agent` lets the load check reuse sockets.
import http from "node:http";
import https from "node:https";

export function rawGet(target, { agent, timeoutMs = 10_000, headers = {} } = {}) {
  const u = new URL(target.url);
  const lib = u.protocol === "https:" ? https : http;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      { method: "GET", agent: agent ?? false, headers: { ...(target.host ? { host: target.host } : {}), "accept-encoding": "identity", ...headers }, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: foldHeaders(res.rawHeaders), rawHeaders: res.rawHeaders, body, ms: performance.now() - started });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

/** `rawHeaders` ([name, value, ...]) as { lowercased-name: [values] }. */
export function foldHeaders(raw) {
  const out = {};
  for (let i = 0; i < raw.length; i += 2) (out[raw[i].toLowerCase()] ??= []).push(raw[i + 1]);
  return out;
}
