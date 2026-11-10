// A stand-in for the storage origin (PUBLIC_SITE_MEDIA_ORIGIN) so the local LCP run loads real image bytes. It serves the same path shape as the
// Supabase public bucket and a generated 1600x900 WebP (about 150 KB, the size of a re-encoded phone photo at quality 82; the logo is a small one).
// Staging does not use this: the page there points at the real storage origin.
import http from "node:http";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadSharp } from "./resolve.mjs";

async function makeImage(width, height, sigma) {
  const sharp = loadSharp();
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const n = (rnd() - 0.5) * sigma * 2;
      raw[i] = Math.max(0, Math.min(255, 40 + (x / width) * 120 + n));
      raw[i + 1] = Math.max(0, Math.min(255, 60 + (y / height) * 100 + n));
      raw[i + 2] = Math.max(0, Math.min(255, 90 + ((x + y) / (width + height)) * 80 + n));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).webp({ quality: 82 }).toBuffer();
}

export async function startMediaStub(port) {
  const big = await makeImage(1600, 900, 8);
  const small = await makeImage(256, 256, 8);
  const server = http.createServer((req, res) => {
    const m = /^\/storage\/v1\/object\/public\/gym-page-media\/([0-9a-f-]{36})\.webp$/.exec(req.url ?? "");
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    // the fixture's logo key ends in ...0001; every other key is a banner or gallery image
    const body = m[1].endsWith("000000000001") ? small : big;
    res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": body.length, "Cache-Control": "public, max-age=3600" });
    res.end(body);
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  return { server, bigBytes: big.length, smallBytes: small.length, close: () => new Promise((r) => server.close(() => r())) };
}

// CLI: node media-stub.mjs <port>   (run-local.sh starts it in the background)
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? 3911);
  const s = await startMediaStub(port);
  console.log(`media stub on 127.0.0.1:${port} (banner ${s.bigBytes} bytes, logo ${s.smallBytes} bytes)`);
}
