/**
 * Story 24.9: the strict Zod status schema against the SQL contract. The pgTAP test pins every key path of get_gym_page_status();
 * the migration holds the state `case`. This test reads both files, so a fact added on one side only fails here. The pinned list covers
 * only the paths the pgTAP test gyms exercise (not, for example, every snapshot hours day), so the strict snapshot schema is also
 * guarded by the 24.8 key-path test and the `publishRows` test.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_STATUS_STATES, gymPageStatusSchema } from "@gymos/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sqlTest = readFileSync(join(root, "supabase", "tests", "gym_page_status.test.sql"), "utf8");
const migration = readFileSync(join(root, "supabase", "migrations", "0165_gym_page_status.sql"), "utf8");

function pinnedPaths(): string[] {
  const m = sqlTest.match(/unnest\(array\[\s*('about_min_chars'[\s\S]*?)\]\) x\),\s*'STATUS KEY PATHS/);
  expect(m, "the pinned STATUS KEY PATHS list").toBeTruthy();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Every key path of a value: objects as a.b, array elements as a[] and a[].b (the same walk as pg_temp.key_paths). */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((el) => [`${prefix}[]`, ...keyPaths(el, `${prefix}[]`)]);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = prefix ? `${prefix}.${k}` : k;
      return [p, ...keyPaths(v, p)];
    });
  }
  return [];
}

// A status that carries every fact the database can return (a live page with media, plans, hours and a hostile plan name).
const full = {
  state: "published",
  template: "classic",
  published_at: "2026-11-08T10:00:00+00:00",
  unpublished_reasons: ["no_banner"],
  missing: ["bad_text"],
  bad_text_fields: [{ field: "plan_name", lang: "fr", plan_name: "Monthly" }],
  about_min_chars: 100,
  languages: [{ code: "en", complete: true, characters: 120, needed: 0 }],
  media: [{ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", kind: "gallery", derivative_key: "a.webp", sort_order: 1 }],
  snapshot: {
    name: "Gym",
    about_fr: "x",
    services_fr: "y",
    address: "Rue 1",
    city: "Douala",
    country: "CM",
    category: "gym",
    map: { lat: 4.05, lng: 9.7 },
    contact: { phone: "+237600111222", whatsapp: "+237600111223" },
    color: "#1A2B3C",
    logo: "l.webp",
    banner: "b.webp",
    gallery: ["g.webp"],
    hours: { mon: { open: "06:00", close: "22:00" }, sun: null },
    plans: [{ name: "Monthly", label_en: "Monthly", label_fr: "Monthly", type: "monthly", price: 1, currency: "XAF", interval: "monthly", duration_days: 30 }],
  },
};

describe("get_gym_page_status contract", () => {
  const pinned = pinnedPaths();

  it("reads a non-trivial pinned list", () => {
    expect(pinned.length).toBeGreaterThan(40);
    expect(pinned).toContain("state");
    expect(pinned).toContain("snapshot.plans[].price");
  });

  it("the full sample is accepted by the strict schema", () => {
    expect(gymPageStatusSchema.safeParse(full).success).toBe(true);
  });

  it("the sample exercises every pinned path, so the schema accepts every path the database can return", () => {
    const have = new Set(keyPaths(full));
    expect(pinned.filter((p) => !have.has(p))).toEqual([]);
  });

  it("the schema is strict: a key the pinned list lacks is refused", () => {
    expect(gymPageStatusSchema.safeParse({ ...full, snapshot: { ...full.snapshot, extra_key: 1 } }).success).toBe(false);
    expect(gymPageStatusSchema.safeParse({ ...full, extra_fact: 1 }).success).toBe(false);
  });

  it("PAGE_STATUS_STATES equals the states of the SQL `case`", () => {
    const start = migration.indexOf("v_state := case");
    const end = migration.indexOf("end;", start);
    expect(start).toBeGreaterThan(-1);
    const states = [...migration.slice(start, end).matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(states)].sort()).toEqual([...PAGE_STATUS_STATES].sort());
  });
});
