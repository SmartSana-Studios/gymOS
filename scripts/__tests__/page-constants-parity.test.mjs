import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Epic 24 retro D7 and D8: constants that exist in more than one place for a reason (a plain Node/SQL/Next config cannot import the
// others) are checked against each other here, so one cannot change alone.
const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("the page media upload cap: TypeScript constant, both Storage bucket limits and the Server Action body limit agree (D7)", () => {
  const ts = read("packages/types/src/schemas/gym.ts").match(/export const PAGE_MEDIA_MAX_BYTES = (\d+) \* (\d+) \* (\d+);/);
  assert.ok(ts, "PAGE_MEDIA_MAX_BYTES not found");
  const cap = Number(ts[1]) * Number(ts[2]) * Number(ts[3]);
  assert.equal(cap, 4 * 1024 * 1024, "the owner chose 4 MiB (Vercel's request body limit)");
  const sql = read("supabase/migrations/0162_gym_page_media.sql");
  const limits = [...sql.matchAll(/\('gym-page-media(?:-src)?',\s*'gym-page-media(?:-src)?',\s*(?:true|false),\s*(\d+),/g)].map((m) => Number(m[1]));
  assert.deepEqual(limits, [cap, cap], "both buckets (private originals, public derivatives) carry the cap");
  const next = read("apps/dashboard/next.config.ts").match(/bodySizeLimit:\s*"(\d+)mb"/i);
  assert.ok(next, "the Server Action bodySizeLimit not found");
  const body = Number(next[1]) * 1024 * 1024;
  assert.ok(body > cap, "the Server Action body limit must exceed the file cap (multipart framing and form fields)");
  assert.ok(body <= cap * 2, "...but not be a free-for-all");
});

test("the public pages domain: the dashboard and Super Admin constants are the same value (D8)", () => {
  const dash = read("apps/dashboard/lib/landingPage.ts").match(/export const PAGE_PUBLIC_DOMAIN = "([^"]+)"/);
  const sa = read("apps/super-admin/app/(admin)/pages/tabs.ts").match(/export const PAGE_PUBLIC_DOMAIN = "([^"]+)"/);
  assert.ok(dash && sa, "PAGE_PUBLIC_DOMAIN not found in both apps");
  assert.equal(sa[1], dash[1]);
  assert.equal(dash[1], "gymosapps.com");
});
