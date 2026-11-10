import { test, expect, type Page } from "@playwright/test";

import { loginViaUi } from "./helpers/auth";
// the same judge the HTTP gate kit uses (scripts/landing-gate/check-http.mjs): the exact AD-44 header set, asserted here against the real Next server
import { checkResponse } from "../../../scripts/landing-gate/lib/headers.mjs";
import {
  LANDING_PORT,
  aal2Required,
  createPageGym,
  createSuperAdmin,
  landingGet,
  locale,
  mediaOrigin,
  removePageGym,
  removeSuperAdmin,
  sameness,
  type Lang,
  type LandingResponse,
  type PageGym,
  type SuperAdmin,
} from "./helpers/landingGate";

// Story 24.12 (PRD 10.2 release gate): the page flows, end to end, in English and in French.
//
//   Owner claims a name (UI) -> fills the gate (the editor's own RPCs) -> publishes (UI) -> the page shows on the LANDING server (second webServer,
//   root domain `localhost`, the label in the Host header; no DNS) -> renames and the old name answers ONE 301 -> unpublishes (UI) -> republishes ->
//   a Super Admin takes the page down (RPC, aal2 flag off) -> the not-found of an unknown, an unpublished, a taken-down and a reserved label is
//   one identical response.
//
// Each language gets its own gym and Owner (a name can be renamed twice in 12 months, so one gym cannot serve both runs). French runs set
// `users.preferred_language = 'fr'` and assert the French words the app really shows, read from locales/fr.json.

test.describe.configure({ mode: "serial" });

/** The problems `scripts/landing-gate/lib/headers.mjs` finds in a response (empty = the exact header set of its kind). */
const judge = (kind: "page" | "notFound" | "redirect", r: LandingResponse, extra: { location?: string } = {}): string[] =>
  checkResponse(kind, { status: r.status, headers: r.rawHeaders, body: r.body }, { mediaOrigin: mediaOrigin(), ...extra }).problems;

for (const lang of ["en", "fr"] as const) {
  test.describe(`Landing page gate, ${lang.toUpperCase()}`, () => {
    let pg: PageGym;
    let sa: SuperAdmin;
    const L = locale(lang).pageEditor;
    /** Responses of each hidden cause, compared with the unknown label's at the end. */
    const answers: Record<string, string> = {};

    test.beforeAll(async () => {
      // without it the landing server cannot log in as public_site_reader and answers the cached not-found for every page, which reads as a 404 at "page shows"
      if (!process.env.PUBLIC_SITE_READER_PASSWORD) throw new Error("PUBLIC_SITE_READER_PASSWORD is not set: this spec needs the password ci-local.sh / ci.yml give the public_site_reader role (see scripts/ci-local.sh, stage e2e)");
      for (const k of Object.keys(answers)) delete answers[k]; // a Playwright retry reruns this group: no stale responses to compare
      pg = await createPageGym(lang);
      sa = await createSuperAdmin();
      // the takedown goes through `is_super_admin_live()`, which asks for aal2 only while this flag is on: assert it is off
      expect(await aal2Required(), "the super_admin_aal2 platform flag must be OFF in the test database").toBe(false);
    });

    test.afterAll(async () => {
      if (sa) await removeSuperAdmin(sa);
      if (pg) await removePageGym(pg);
    });

    const host = (name: string) => `${name}.localhost`;
    const openEditor = async (page: Page) => {
      await page.goto("/settings/landing-page");
      await expect(page.getByRole("heading", { level: 1, name: L.title })).toBeVisible();
    };

    test("the locale files differ on the labels this spec drives, so the French run really reads French", async () => {
      const other = locale(lang === "en" ? "fr" : "en").pageEditor;
      for (const key of [L.name.claim, L.publish.button, L.header.unpublish]) expect(key).toBeTruthy();
      expect(L.name.claim).not.toBe(other.name.claim);
      expect(L.publish.button).not.toBe(other.publish.button);
    });

    test("Owner claims a name, publishes, and the page shows on the landing server", async ({ page }) => {
      await loginViaUi(page, pg.ownerEmail);
      await openEditor(page);

      await page.getByRole("button", { name: L.name.claim }).click();
      await page.locator("#pageNameInput").fill(pg.names.first);
      await page.getByRole("button", { name: L.name.claimButton }).click();
      await expect(page.getByTestId("page-name-state")).toContainText(`${pg.names.first}.`);

      await page.goto("/settings/landing-page/publish");
      await expect(page.getByRole("heading", { level: 1, name: L.publish.title })).toBeVisible();
      await expect(page.getByTestId("public-address")).toContainText(pg.names.first);
      await page.locator("#publishAttest").click();
      await page.getByRole("button", { name: L.publish.button, exact: true }).click();
      await expect(page.getByTestId("publish-success")).toBeVisible();

      // the page, as a visitor's browser gets it (Chromium resolves *.localhost itself)
      await page.goto(`http://${host(pg.names.first)}:${LANDING_PORT}/`);
      await expect(page.locator("html")).toHaveAttribute("lang", /^(en|fr)$/);
      await expect(page.getByText(pg.gymName).first()).toBeVisible();

      // and as raw HTTP: the AD-44 headers on the real response, the language by Accept-Language, no cookie
      const asked = await landingGet(pg.names.first, "/", { "accept-language": lang === "fr" ? "fr" : "en" });
      expect(asked.status).toBe(200);
      expect(asked.body).toContain(`<html lang="${lang}"`);
      expect(asked.body).toContain(pg.gymName);
      expect(asked.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(asked.headers["set-cookie"]).toBeUndefined();
      expect(judge("page", asked), "the published page carries the exact AD-44 header set").toEqual([]);
      const otherLang: Lang = lang === "fr" ? "en" : "fr";
      const other = await landingGet(pg.names.first, "/", { "accept-language": otherLang });
      expect(other.body).toContain(`<html lang="${otherLang}"`);
    });

    test("Owner unpublishes: the page becomes the not-found, the name stays reserved", async ({ page }) => {
      await loginViaUi(page, pg.ownerEmail);
      await openEditor(page);
      await page.getByRole("button", { name: L.header.unpublish, exact: true }).click();
      await page.getByRole("button", { name: L.unpublish.confirm, exact: true }).click();
      await expect(page.getByText(L.unpublish.toast).first()).toBeVisible();

      const res = await landingGet(pg.names.first);
      expect(res.status).toBe(404);
      expect(judge("notFound", res), "the not-found carries the exact AD-44 header set").toEqual([]);
      answers.unpublished = sameness(res);
      // the name is still the gym's: a status read says so
      await expect(page.getByTestId("page-name-state")).toContainText(`${pg.names.first}.`);
    });

    test("Owner republishes, renames, and the old name answers ONE 301 to the new name", async ({ page }) => {
      await loginViaUi(page, pg.ownerEmail);
      await page.goto("/settings/landing-page/publish");
      await page.locator("#publishAttest").click();
      await page.getByRole("button", { name: L.publish.button, exact: true }).click();
      await expect(page.getByTestId("publish-success")).toBeVisible();
      expect((await landingGet(pg.names.first)).status).toBe(200);

      await openEditor(page);
      await page.getByRole("button", { name: L.name.change }).click();
      await page.locator("#pageNameInput").fill(pg.names.second);
      await page.getByRole("button", { name: L.name.rename, exact: true }).click();
      await expect(page.getByTestId("page-name-state")).toContainText(`${pg.names.second}.`);

      const old = await landingGet(pg.names.first);
      expect(old.status).toBe(301);
      expect(old.headers["location"]).toBe(`http://${host(pg.names.second)}/`);
      expect(old.body).toBe("");
      expect(judge("redirect", old, { location: `http://${host(pg.names.second)}/` }), "the 301 carries the exact AD-44 header set").toEqual([]);
      // one hop: the target is the page itself, not another redirect
      const target = await landingGet(pg.names.second);
      expect(target.status).toBe(200);
      expect(target.headers["location"]).toBeUndefined();
    });

    test("a Super Admin takes the page down: it is hidden, the old name stops redirecting, the Owner sees why", async ({ page }) => {
      const before = await landingGet(pg.names.second);
      expect(before.status).toBe(200);
      const { error } = await sa.client.rpc("take_down_gym_page", { p_gym_id: pg.gymId, p_reason: "other", p_note: "E2E takedown for the landing page gate" });
      expect(error, error?.message).toBeNull();

      const hidden = await landingGet(pg.names.second);
      expect(hidden.status).toBe(404);
      answers.takenDown = sameness(hidden);
      expect((await landingGet(pg.names.first)).status).toBe(404); // the old name no longer redirects to a hidden page

      await loginViaUi(page, pg.ownerEmail);
      await openEditor(page);
      await expect(page.getByTestId("banner-taken-down")).toBeVisible();
    });

    test("every hidden cause answers the same not-found: unknown, unpublished, taken down, reserved", async () => {
      const unknown = await landingGet(`e2e-nobody-${pg.names.first}`.slice(0, 30));
      const reserved = await landingGet("test");
      expect(unknown.status).toBe(404);
      expect(reserved.status).toBe(404);
      answers.unknown = sameness(unknown);
      answers.reserved = sameness(reserved);
      expect(Object.keys(answers).sort()).toEqual(["reserved", "takenDown", "unknown", "unpublished"]);
      for (const cause of ["unpublished", "takenDown", "reserved"]) {
        expect(answers[cause], `${cause} must be byte-identical to an unknown label`).toBe(answers.unknown);
      }
    });
  });
}
