import { test, expect } from "@playwright/test";

import { loginViaUi } from "./helpers/auth";
// the same judges the HTTP gate kit uses (scripts/landing-gate): the exact AD-44 header set of a directory page, and the removal surfaces with their bounds
import { checkResponse, locsOf } from "../../../scripts/landing-gate/lib/headers.mjs";
import { SURFACES, judgeRemoval, pollRemoval, probeAll } from "../../../scripts/landing-gate/lib/removal.mjs";
import {
  LANDING_PORT,
  aal2Required,
  claimAndPublish,
  createPageGym,
  createSuperAdmin,
  landingGet,
  liftTakedown,
  mediaOrigin,
  publishPage,
  randomPageName,
  removePageGym,
  removeSuperAdmin,
  setGymStatusScoped,
  signedInClient,
  type Lang,
  type PageGym,
  type SuperAdmin,
} from "./helpers/landingGate";

// Story 25.6 (PRD 10.2 release gate; FR-207, FR-211..FR-214): the directory, end to end, in English and in French.
//
//   browse top -> country -> city; the category filter; a thin city (2 gyms: noindex, not in the sitemap) and an indexable one (3 gyms: indexable, in the
//   sitemap); and the removal of a gym by each of the three causes (the Owner unpublishes, a Super Admin takes the page down, the gym is suspended), timed
//   on every public surface and asserted within 60 s at the ORIGIN. The CDN (5 min) and sitemap (15 min) bounds are shown by construction (s-maxage on every
//   answer, scripts/landing-gate/lib/removal.mjs) and measured only on staging.
//
// Each language gets its OWN gyms and cities (seeded cities nobody else uses: Kribi and Limbe for English, Ebolowa and Buea for French; the 24.12 spec uses
// Douala), created through the Owner's own RPCs and removed in afterAll. Between cases the removed gym is restored, so the next case starts from three
// gyms again: a city of exactly three is the one whose removal also changes the sitemap.
//
// Suspension: `gyms.status` is pinned by a trigger for everyone but the billing lifecycle job, so a bare UPDATE silently reverts. The spec uses the job's own
// transaction-local bypass, scoped to one gym through a direct connection (helpers/landingGate.ts setGymStatusScoped); never run_saas_billing_lifecycle_job(),
// which acts on every gym.

test.describe.configure({ mode: "serial" });

const CITIES = {
  en: { three: "kribi", thin: "limbe" },
  fr: { three: "ebolowa", thin: "buea" },
} as const;
const COUNTRY = "cm";
/** The three gyms of the indexable city: two share a category, one differs, so the filter has something to filter. */
const CATEGORIES = ["gym", "yoga_studio", "gym"] as const;
const REMOVAL_BOUND_S = 60;

const get = async (label: string, path: string, headers: Record<string, string> = {}) => {
  const r = await landingGet(label, path, headers);
  return { status: r.status, headers: r.rawHeaders, body: r.body };
};

/** The problems the kit finds in a directory response (empty = the exact page set of its kind; `indexable` states what the page must say). */
const judgeDirectory = (r: { status: number; headers: Record<string, string[]>; body: string }, indexable: boolean): string[] =>
  checkResponse("directory", r, { mediaOrigin: mediaOrigin(), indexable }).problems;

/** Every URL the www sitemap lists, as written (`locs`, query string included) and as paths (`paths`): the index, then each file it names. */
async function sitemapPaths(): Promise<{ paths: Set<string>; locs: string[] }> {
  const index = await get("www", "/sitemap-index.xml");
  expect(index.status, "the sitemap index").toBe(200);
  const paths = new Set<string>();
  const locs: string[] = [];
  for (const loc of locsOf(index.body)) {
    const file = await get("www", new URL(loc).pathname);
    expect(file.status, `sitemap file ${loc}`).toBe(200);
    for (const entry of locsOf(file.body)) {
      locs.push(entry);
      paths.add(new URL(entry).pathname);
    }
  }
  return { paths, locs };
}

for (const lang of ["en", "fr"] as const) {
  test.describe(`Directory gate, ${lang.toUpperCase()}`, () => {
    const place = CITIES[lang];
    const accept = { "accept-language": lang === "fr" ? "fr" : "en" };
    const cityPath = (slug: string) => `/${lang}/gyms/${COUNTRY}/${slug}`;
    const three: PageGym[] = [];
    const thin: PageGym[] = [];
    const pageName = new Map<string, string>(); // gym id -> its page name (the gym's subdomain)
    let sa: SuperAdmin;
    /** What each removal measured, printed at the end of the group. */
    const measured: string[] = [];

    const publishNew = async (into: PageGym[], city: string, category: string) => {
      const pg = await createPageGym(lang, city);
      into.push(pg); // before the claim, so afterAll removes it even when the claim fails
      const name = randomPageName();
      pageName.set(pg.gymId, name);
      await claimAndPublish(pg, name, category);
    };

    test.beforeAll(async () => {
      test.setTimeout(300_000);
      if (!process.env.PUBLIC_SITE_READER_PASSWORD) throw new Error("PUBLIC_SITE_READER_PASSWORD is not set: this spec needs the password ci-local.sh / ci.yml give the public_site_reader role (see scripts/ci-local.sh, stage e2e)");
      sa = await createSuperAdmin();
      expect(await aal2Required(), "the super_admin_aal2 platform flag must be OFF in the test database").toBe(false);
      for (const category of CATEGORIES) await publishNew(three, place.three, category);
      for (let i = 0; i < 2; i++) await publishNew(thin, place.thin, "gym");
    });

    test.afterAll(async () => {
      // every gym is removed even when the Super Admin's removal throws: a leftover published gym breaks the next run's exact city counts
      const failures: unknown[] = [];
      for (const step of [async () => { if (sa) await removeSuperAdmin(sa); }, ...[...three, ...thin].map((pg) => () => removePageGym(pg))]) {
        try {
          await step();
        } catch (e) {
          failures.push(e);
        }
      }
      if (measured.length) console.log(`\ndirectory gate ${lang.toUpperCase()}: removal timing (LOCAL, origin; CDN and sitemap bounds by construction)\n${measured.join("\n")}`);
      if (failures.length) throw new Error(`directory gate ${lang.toUpperCase()}: ${failures.length} cleanup step(s) failed: ${failures.map(String).join("; ")}`);
    });

    const ctxFor = (victim: PageGym) => ({
      label: pageName.get(victim.gymId)!,
      country: COUNTRY,
      city: place.three,
      countBefore: 3,
      locale: lang,
      rootDomain: "localhost",
      wwwLabel: "www",
    });

    test("nobody else lists in this spec's cities, and all five gyms are visible", async () => {
      const city = await get("www", cityPath(place.three), accept);
      expect(city.status).toBe(200);
      expect(city.body, "the indexable city lists exactly the three gyms of this spec").toMatch(/<p class="count">\s*3 /);
      const small = await get("www", cityPath(place.thin), accept);
      expect(small.status).toBe(200);
      expect(small.body, "the thin city lists exactly the two gyms of this spec").toMatch(/<p class="count">\s*2 /);
      for (const pg of [...three, ...thin]) {
        const g = await get(pageName.get(pg.gymId)!, "/", accept);
        expect(g.status, `the page of ${pg.gymName}`).toBe(200);
      }
    });

    test("browse top -> country -> city in a browser, in the language of the path", async ({ page }) => {
      const origin = `http://www.localhost:${LANDING_PORT}`;
      await page.goto(`${origin}/${lang}/gyms`);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await page.getByRole("link", { name: /^(Cameroon|Cameroun)/ }).click();
      await expect(page).toHaveURL(`${origin}/${lang}/gyms/${COUNTRY}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/Cameroon|Cameroun/);

      const cityName = place.three.charAt(0).toUpperCase() + place.three.slice(1);
      await page.getByRole("link", { name: new RegExp(`^${cityName}`) }).click();
      await expect(page).toHaveURL(`${origin}${cityPath(place.three)}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(cityName);
      for (const pg of three) await expect(page.getByText(pg.gymName).first()).toBeVisible();

      // each row links to the gym's own subdomain
      for (const pg of three) await expect(page.locator(`a[href="http://${pageName.get(pg.gymId)}.localhost/"]`)).toHaveCount(1);
    });

    test("raw HTTP: the three levels carry the directory page set, the right language and the right counts", async () => {
      const top = await get("www", `/${lang}/gyms`, accept);
      expect(top.status).toBe(200);
      expect(judgeDirectory(top, true), "the top page").toEqual([]);
      expect(top.body).toContain(`<html lang="${lang}"`);
      expect(top.body).toContain(`href="/${lang}/gyms/${COUNTRY}"`);

      const country = await get("www", `/${lang}/gyms/${COUNTRY}`, accept);
      expect(country.status).toBe(200);
      expect(judgeDirectory(country, true), "the country page").toEqual([]);
      expect(country.body).toContain(`<html lang="${lang}"`);
      expect(country.body).toMatch(new RegExp(`href="${cityPath(place.three)}"[^>]*><div><h2>[^<]*</h2><p>3 `));
      expect(country.body).toMatch(new RegExp(`href="${cityPath(place.thin)}"[^>]*><div><h2>[^<]*</h2><p>2 `));

      const city = await get("www", cityPath(place.three), accept);
      expect(city.status).toBe(200);
      expect(judgeDirectory(city, true), "the indexable city page").toEqual([]);
      expect(city.body).toContain(`<html lang="${lang}"`);
      expect(city.body).toMatch(/<p class="count">\s*3 /);
      // hreflang en, fr and x-default, and a self-referencing canonical on the configured origin
      expect(city.body).toContain(`<link rel="canonical" href="http://www.localhost${cityPath(place.three)}"`);
      expect(city.body).toMatch(/hreflang="en"/i);
      expect(city.body).toMatch(/hreflang="fr"/i);
      expect(city.body).toMatch(/hreflang="x-default"/i);

      // the other language is the other language
      const other: Lang = lang === "en" ? "fr" : "en";
      const flipped = await get("www", `/${other}/gyms/${COUNTRY}/${place.three}`, accept);
      expect(flipped.body).toContain(`<html lang="${other}"`);
    });

    test("category filter: pills only for present categories; a filtered view is canonical to the unfiltered one, has no noindex and is not in the sitemap", async () => {
      const city = await get("www", cityPath(place.three), accept);
      const hrefs = [...new Set([...city.body.matchAll(/href="([^"]*\?category=[a-z_]+)"/g)].map((m) => m[1]))].sort();
      expect(hrefs, "pills exist for the categories the three gyms have, and for no other").toEqual([`${cityPath(place.three)}?category=gym`, `${cityPath(place.three)}?category=yoga_studio`]);
      expect(city.body).toContain(`<a href="${cityPath(place.three)}"`); // the "All" pill

      const filtered = await get("www", `${cityPath(place.three)}?category=yoga_studio`, accept);
      expect(filtered.status).toBe(200);
      expect(judgeDirectory(filtered, true), "a filtered view is never noindex").toEqual([]);
      expect(filtered.headers["x-robots-tag"]).toBeUndefined();
      expect(filtered.body).not.toMatch(/<meta name="robots"/);
      expect(filtered.body).toContain(`<link rel="canonical" href="http://www.localhost${cityPath(place.three)}"`);
      expect(filtered.body, "the filtered view counts the gyms it lists").toMatch(/<p class="count">\s*1 /);
      // gym names are stored upper-cased (migration 0159), so compare without case
      expect(filtered.body.toLowerCase()).toContain(three[1]!.gymName.toLowerCase());
      expect(filtered.body.toLowerCase()).not.toContain(three[0]!.gymName.toLowerCase());

      // a valid category with no gym in the city is a 200 with a message, not an error
      const stale = await get("www", `${cityPath(place.three)}?category=pilates_studio`, accept);
      expect(stale.status).toBe(200);
      expect(stale.headers["x-robots-tag"]).toBeUndefined();

      const { locs } = await sitemapPaths();
      // on the raw <loc> text: a pathname never carries the query string
      expect(locs.filter((l) => l.includes("?") || l.includes("category=")), "no filtered view in the sitemap").toEqual([]);
    });

    test("a thin city (2 gyms) is noindex in the header and the meta tag and out of the sitemap; a city of 3 is indexable and in it", async () => {
      const small = await get("www", cityPath(place.thin), accept);
      expect(small.status).toBe(200);
      expect(judgeDirectory(small, false), "header and meta tag agree on noindex").toEqual([]);
      expect(small.headers["x-robots-tag"]).toEqual(["noindex"]);
      expect(small.body).toContain('<meta name="robots" content="noindex"');

      const big = await get("www", cityPath(place.three), accept);
      expect(big.headers["x-robots-tag"]).toBeUndefined();
      expect(big.body).not.toMatch(/<meta name="robots"/);

      const { paths } = await sitemapPaths();
      for (const l of ["en", "fr"]) {
        expect(paths.has(`/${l}/gyms/${COUNTRY}/${place.thin}`), `thin city ${l} must not be in the sitemap`).toBe(false);
        expect(paths.has(`/${l}/gyms/${COUNTRY}/${place.three}`), `indexable city ${l} must be in the sitemap`).toBe(true);
      }
      // no gym page is ever listed by the main-site sitemap
      expect([...paths].filter((p) => !p.startsWith("/en") && !p.startsWith("/fr"))).toEqual([]);
    });

    const everySurface = SURFACES.map((s: { id: string }) => s.id);

    /** Records and judges one removal: polls every surface from `since`, asserts the ORIGIN bound of 60 s, keeps the table for the log. */
    async function expectRemoved(cause: string, victim: PageGym, since: number): Promise<void> {
      const ctx = ctxFor(victim);
      const results = await pollRemoval({ get, ctx, since, boundS: REMOVAL_BOUND_S, pollMs: 250 });
      const verdict = judgeRemoval(results, { mode: "origin" });
      const table = [`  ${cause}:`, ...verdict.lines.map((l: string) => `  ${l}`)].join("\n");
      measured.push(table);
      test.info().annotations.push({ type: `removal-timing ${cause}`, description: verdict.lines.join(" | ") });
      expect(verdict.failures, `a surface kept the removed gym (${cause}):\n${table}`).toEqual([]);
    }
    /** The gym is on every surface (so a measured removal is a removal that really happened). */
    async function expectVisibleEverywhere(victim: PageGym, when: string): Promise<void> {
      await expect
        .poll(async () => {
          const state = (await probeAll({ get, ctx: ctxFor(victim) })) as Record<string, { gone: boolean; broken?: boolean; note?: string }>;
          // a surface that could not be read is not "visible" either
          return Object.entries(state).filter(([, v]) => v.gone || v.broken).map(([k]) => k);
        }, { message: `${when}: the gym must be on every surface`, timeout: 15_000 })
        .toEqual([]);
    }

    test("removal on unpublish: every surface drops within 60 s at the origin", async () => {
      const victim = three[0]!;
      const owner = await signedInClient(victim.ownerEmail);
      await expectVisibleEverywhere(victim, "before the unpublish");
      expect(Object.keys(await probeAll({ get, ctx: ctxFor(victim) }))).toEqual(everySurface);

      const since = Date.now();
      const { error } = await owner.rpc("unpublish_gym_page", { p_gym_id: victim.gymId });
      expect(error, error?.message).toBeNull();
      await expectRemoved("unpublish", victim, since);

      // the name stays the gym's: republishing restores it everywhere for the next case
      await publishPage(victim);
      await expectVisibleEverywhere(victim, "after the republish");
    });

    test("removal on takedown: every surface drops within 60 s, the Owner still sees the banner", async ({ page }) => {
      const victim = three[1]!;
      await expectVisibleEverywhere(victim, "before the takedown");

      const since = Date.now();
      const { error } = await sa.client.rpc("take_down_gym_page", { p_gym_id: victim.gymId, p_reason: "other", p_note: "E2E takedown for the directory gate" });
      expect(error, error?.message).toBeNull();
      await expectRemoved("takedown", victim, since);

      await loginViaUi(page, victim.ownerEmail);
      await page.goto("/settings/landing-page");
      await expect(page.getByTestId("banner-taken-down")).toBeVisible();

      // lift (the page comes back unpublished) and publish again for the next case
      await liftTakedown(sa, victim.gymId);
      await publishPage(victim);
      await expectVisibleEverywhere(victim, "after the lift and the republish");
    });

    test("removal on suspension: every surface drops within 60 s, and the Owner cannot republish", async () => {
      const victim = three[2]!;
      const owner = await signedInClient(victim.ownerEmail);
      await expectVisibleEverywhere(victim, "before the suspension");

      const since = Date.now();
      await setGymStatusScoped(victim.gymId, "suspended");
      await expectRemoved("suspension", victim, since);

      const refused = await owner.rpc("publish_gym_page", { p_gym_id: victim.gymId });
      expect(refused.error, "a suspended gym's republish must be refused").not.toBeNull();
      expect(refused.error?.message, "refused because the gym is not active, not for another reason").toMatch(/not active/);
      // and it stays off every surface after the refusal
      const state = (await probeAll({ get, ctx: ctxFor(victim) })) as Record<string, { gone: boolean }>;
      expect(Object.entries(state).filter(([, v]) => !v.gone).map(([k]) => k), "nothing came back").toEqual([]);

      await setGymStatusScoped(victim.gymId, "active");
      await expectVisibleEverywhere(victim, "after the reactivation");
    });
  });
}
