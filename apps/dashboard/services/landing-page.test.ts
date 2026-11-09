// Story 24.9: the landing-page service. Mocked Supabase; the mappers are pinned against the REAL messages the migrations raise.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_NAME_ERROR_CODES, PAGE_PUBLISH_ERROR_CODES } from "@gymos/types";

const GYM = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const getClaims = vi.fn();
let gymRow: Record<string, unknown> | null = null;
let plansRows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getClaims: (...a: unknown[]) => getClaims(...a) },
    from: (table: string) =>
      table === "gyms"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: gymRow, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: async () => ({ data: plansRows, error: null }) }) }) },
  })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
const commit = vi.fn(async () => true);
const discard = vi.fn(async () => undefined);
const rebuildPurgedMedia = vi.fn(async (_gymId: string): Promise<{ ok: true; ids: string[]; commit: typeof commit; discard: typeof discard } | { ok: false }> => ({ ok: true, ids: [], commit, discard }));
vi.mock("@/services/page-media", () => ({ rebuildPurgedMedia: (g: string) => rebuildPurgedMedia(g) }));

import {
  claimLandingPageName,
  getLandingPageData,
  getLandingPageState,
  pageContentCodeFromDbError,
  pageNameCodeFromDbError,
  pagePublishCodeFromDbError,
  publishLandingPage,
  pageAppealCodeFromDbError,
  saveLandingPageContent,
  submitLandingPageAppeal,
  unpublishLandingPage,
} from "./landing-page";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations");
const m163 = readFileSync(join(migrations, "0163_page_names.sql"), "utf8");
const m164 = readFileSync(join(migrations, "0164_publish_gate_snapshot.sql"), "utf8");
const m161 = readFileSync(join(migrations, "0161_gym_page_content.sql"), "utf8");
const m167claim = readFileSync(join(migrations, "0167_page_takedown_reports_media_purge.sql"), "utf8");

const status = {
  state: "ready", template: null, published_at: null, unpublished_reasons: [], missing: [], bad_text_fields: [], about_min_chars: 100,
  languages: [{ code: "en", complete: true, characters: 120, needed: 0 }, { code: "fr", complete: false, characters: 0, needed: 100 }],
  media: [], snapshot: { name: "Gym", default_language: "en" }, taken_down_reason: null, appeal: null,
};
const nameState = { name: "grace-fit", state: "active", pending_name: null, completed_renames: 0, redirects: [] };

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { gym_id: GYM, app_role: "owner" } }, error: null });
  gymRow = { category: "pilates_studio", country: "CM", default_language: "fr", page_about_en: "About", page_about_fr: null, page_services_en: null, page_services_fr: "A\nB", page_address: "Rue 1", page_city: "Douala", page_lat: 4.05, page_lng: null, page_hours: { mon: { open: "06:00", close: "22:00" }, sun: null }, page_contact_phone: "+237600111222", page_contact_whatsapp: null };
  plansRows = [{ id: "p1", name: "Monthly", plan_type: "monthly", price: 10000, currency: "XAF", billing_interval: "monthly", duration_days: 30, is_public: true }];
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_gym_page_status") return { data: status, error: null };
    if (fn === "get_gym_page_name") return { data: nameState, error: null };
    return { data: null, error: null };
  });
});

describe("typed error mappers: one test per code against the real message", () => {
  // The messages are asserted to exist in the migrations first, so a renamed message fails here, not in production.
  it.each([
    ["invalid_name", "claim_page_name: invalid_name"],
    ["reserved_name", "claim_page_name: reserved_name"],
    ["name_taken", "claim_page_name: name_taken"],
    ["rename_limit", "claim_page_name: rename_limit"],
  ] as const)("claim_page_name %s", (code, message) => {
    expect(m163).toContain(`raise exception '${message}'`);
    expect(pageNameCodeFromDbError({ message })).toBe(code);
  });

  it("claim_page_name permission denied -> not_admitted (exact message only)", () => {
    expect(m163).toContain("raise exception 'permission denied'");
    expect(pageNameCodeFromDbError({ message: "permission denied" })).toBe("not_admitted");
    expect(pageNameCodeFromDbError({ message: "permission denied for table gyms" })).toBeNull();
  });

  it("claim_page_name: gym <id> is not active -> gym_not_active", () => {
    expect(m163).toContain("raise exception 'claim_page_name: gym % is not active', p_gym_id");
    expect(pageNameCodeFromDbError({ message: `claim_page_name: gym ${GYM} is not active` })).toBe("gym_not_active");
    expect(pageNameCodeFromDbError({ message: "publish_gym_page: gym x is not active" })).toBeNull();
  });

  it("claim_page_name: page_taken_down (24.11, an Owner cannot rename while the page is taken down)", () => {
    expect(m167claim).toContain("raise exception 'claim_page_name: page_taken_down'");
    expect(pageNameCodeFromDbError({ message: "claim_page_name: page_taken_down" })).toBe("page_taken_down");
  });

  it("every name error code of the schema is reachable from some message", () => {
    const reachable = new Set<string>();
    for (const m of ["permission denied", `claim_page_name: gym ${GYM} is not active`, "claim_page_name: invalid_name", "claim_page_name: reserved_name", "claim_page_name: name_taken", "claim_page_name: rename_limit", "claim_page_name: page_taken_down"]) {
      const c = pageNameCodeFromDbError({ message: m });
      if (c) reachable.add(c);
    }
    expect([...reachable].sort()).toEqual([...PAGE_NAME_ERROR_CODES].sort());
  });

  it.each([
    ["taken_down", "publish_gym_page: taken_down"],
    ["template_required", "publish_gym_page: template_required"],
    ["invalid_template", "publish_gym_page: invalid_template"],
  ] as const)("publish_gym_page %s", (code, message) => {
    expect(m164).toContain(`raise exception '${message}'`);
    expect(pagePublishCodeFromDbError({ message })).toBe(code);
  });

  it("publish_gym_page permission denied and not active", () => {
    expect(pagePublishCodeFromDbError({ message: "permission denied" })).toBe("not_admitted");
    expect(m164).toContain("raise exception 'publish_gym_page: gym % is not active', p_gym_id");
    expect(pagePublishCodeFromDbError({ message: `publish_gym_page: gym ${GYM} is not active` })).toBe("gym_not_active");
    expect(pagePublishCodeFromDbError({ message: "boom" })).toBeNull();
    expect(pagePublishCodeFromDbError(null)).toBeNull();
  });

  it("every publish error code of the schema is reachable", () => {
    const reachable = new Set(
      ["permission denied", `publish_gym_page: gym ${GYM} is not active`, "publish_gym_page: taken_down", "publish_gym_page: template_required", "publish_gym_page: invalid_template"].map((m) => pagePublishCodeFromDbError({ message: m })),
    );
    // rederive_failed is raised by the service itself (a purged image could not be rebuilt), not by a database message
    reachable.add("rederive_failed");
    expect([...reachable].sort()).toEqual([...PAGE_PUBLISH_ERROR_CODES].sort());
  });

  it("set_gym_page_content: invalid_*, permission denied, not active", () => {
    expect(m161).toContain("raise exception 'set_gym_page_content: invalid_%', p_key");
    expect(pageContentCodeFromDbError({ message: "set_gym_page_content: invalid_about_en" })).toBe("invalid_content");
    expect(pageContentCodeFromDbError({ message: "set_gym_page_content: invalid_hours" })).toBe("invalid_content");
    expect(pageContentCodeFromDbError({ message: "set_gym_page_content: plan_not_in_gym" })).toBe("invalid_content");
    expect(pageContentCodeFromDbError({ message: "permission denied" })).toBe("not_admitted");
    expect(m161).toContain("raise exception 'set_gym_page_content: gym % is not active', p_gym_id");
    expect(pageContentCodeFromDbError({ message: `set_gym_page_content: gym ${GYM} is not active` })).toBe("gym_not_active");
    expect(pageContentCodeFromDbError({ message: "set_gym_page_content: gym not found" })).toBeNull();
  });
});

describe("getLandingPageData", () => {
  it("returns the status, the name, the editor fields and the plans for the session's gym", async () => {
    const { data, error } = await getLandingPageData();
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_gym_page_status", { p_gym_id: GYM });
    expect(rpc).toHaveBeenCalledWith("get_gym_page_name", { p_gym_id: GYM });
    expect(data?.role).toBe("owner");
    expect(data?.status.state).toBe("ready");
    expect(data?.content.defaultLanguage).toBe("fr");
    expect(data?.content.about).toEqual({ en: "About", fr: "" });
    expect(data?.content.services.fr).toBe("A\nB");
    expect(data?.content.lat).toBe("4.05");
    expect(data?.content.lng).toBe("");
    expect(data?.content.hours).toEqual({ mon: { open: "06:00", close: "22:00" }, sun: null });
    expect(data?.plans).toEqual([{ id: "p1", name: "Monthly", planType: "monthly", price: 10000, currency: "XAF", billingInterval: "monthly", durationDays: 30, isPublic: true }]);
  });

  it("a role with no page access never reaches the database", async () => {
    getClaims.mockResolvedValue({ data: { claims: { gym_id: GYM, app_role: "manager" } }, error: null });
    const { data, error } = await getLandingPageData();
    expect(data).toBeNull();
    expect(error?.code).toBe("not_admitted");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("permission denied from the status function is the typed not_admitted error (deactivated support)", async () => {
    getClaims.mockResolvedValue({ data: { claims: { gym_id: GYM, app_role: "support" } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { error } = await getLandingPageData();
    expect(error).toEqual({ code: "not_admitted", message: "pageEditor.errors.not_admitted" });
  });

  it("a status shape the client does not know fails closed (load_failed), without throwing", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "get_gym_page_status" ? { data: { ...status, gym_id: GYM }, error: null } : { data: nameState, error: null }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { data, error } = await getLandingPageData();
    expect(data).toBeNull();
    expect(error?.code).toBe("load_failed");
    spy.mockRestore();
  });

  it("getLandingPageState is null when the read fails, never an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await getLandingPageState()).toBeNull();
    rpc.mockResolvedValue({ data: status, error: null });
    expect(await getLandingPageState()).toBe("ready");
  });
});

describe("saveLandingPageContent", () => {
  const valid = { content: { about_en: "x", lat: 4.05, lng: 9.7 }, plans: [{ plan_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", is_public: true }] };

  it("sends the content patch and the plan switches in one call, with the session's gym", async () => {
    await saveLandingPageContent(valid);
    expect(rpc).toHaveBeenCalledWith("set_gym_page_content", { p_gym_id: GYM, p_content: valid.content, p_plans: valid.plans });
  });

  it("refuses markup before calling the database", async () => {
    const { error } = await saveLandingPageContent({ content: { about_en: "<b>x</b>" } });
    expect(error?.code).toBe("invalid_content");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unknown key and a gym id smuggled into the input", async () => {
    expect((await saveLandingPageContent({ content: { gym_id: GYM } })).error?.code).toBe("invalid_content");
    expect((await saveLandingPageContent({ content: {}, gym_id: GYM })).error?.code).toBe("invalid_content");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the invalid_content messages exist in the 0161 migration source", () => {
    expect(m161).toContain("raise exception 'set_gym_page_content: unknown_key %', v_key");
    expect(m161).toContain("raise exception 'set_gym_page_content: unknown_plan_key %', v_key");
    expect(m161).toContain("raise exception 'set_gym_page_content: duplicate_plan_id'");
    expect(m161).toContain("raise exception 'set_gym_page_content: plan_not_in_gym'");
    for (const message of [
      "set_gym_page_content: unknown_key lat2",
      "set_gym_page_content: unknown_plan_key label",
      "set_gym_page_content: duplicate_plan_id",
      "set_gym_page_content: plan_not_in_gym",
      "set_gym_page_content: invalid_plans",
      "set_gym_page_content: invalid_content",
    ]) {
      expect(pageContentCodeFromDbError({ message }), message).toBe("invalid_content");
    }
  });

  it("CRLF and lone CR become LF in About, Services, address and city BEFORE the call (a direct call, not the form)", async () => {
    await saveLandingPageContent({
      content: { about_en: "a\r\nb\rc", about_fr: "x\r\ny", services_en: "one\r\ntwo", services_fr: "s\u0001t", address: "Rue 1\r\nBP 2", city: "Dou\u0007ala", contact_phone: "+237600111222" },
    });
    const sent = rpc.mock.calls.find((c) => c[0] === "set_gym_page_content")?.[1] as { p_content: Record<string, unknown> };
    expect(sent.p_content).toMatchObject({
      about_en: "a\nb\nc",
      about_fr: "x\ny",
      services_en: "one\ntwo",
      services_fr: "st",
      address: "Rue 1\nBP 2",
      city: "Douala",
      contact_phone: "+237600111222",
    });
    expect(JSON.stringify(sent)).not.toContain("\\r");
  });

  it("a save that committed but whose read-back failed is distinct from a failed save", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "set_gym_page_content") return { data: null, error: null };
      return { data: null, error: { message: "network" } };
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await saveLandingPageContent(valid);
    spy.mockRestore();
    expect(result).toEqual({ data: null, error: null, reloadFailed: true });
  });

  it("a normal save returns the fresh data and no reloadFailed flag", async () => {
    const result = await saveLandingPageContent(valid);
    expect(result.error).toBeNull();
    expect(result.data?.status.state).toBe("ready");
    expect(result.reloadFailed).toBeUndefined();
  });

  it("maps the database's refusals to typed errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: `set_gym_page_content: gym ${GYM} is not active` } });
    expect((await saveLandingPageContent(valid)).error?.code).toBe("gym_not_active");
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect((await saveLandingPageContent(valid)).error?.code).toBe("not_admitted");
  });
});

describe("claimLandingPageName", () => {
  it("normalises the name and passes the session's gym", async () => {
    rpc.mockResolvedValue({ data: { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "grace-fit", state: "active", origin: "claim", previous_name: null }, error: null });
    const { data } = await claimLandingPageName("  Grace-Fit ");
    expect(rpc).toHaveBeenCalledWith("claim_page_name", { p_gym_id: GYM, p_name: "grace-fit" });
    expect(data?.state).toBe("active");
  });

  it("a held name is a result, not an error", async () => {
    rpc.mockResolvedValue({ data: { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "grace-gym", state: "held", origin: "claim", previous_name: null }, error: null });
    const { data, error } = await claimLandingPageName("grace-gym");
    expect(error).toBeNull();
    expect(data?.state).toBe("held");
  });

  it("refuses an invalid name without calling the database", async () => {
    const { error } = await claimLandingPageName("a--b");
    expect(error?.code).toBe("invalid_name");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["claim_page_name: reserved_name", "reserved_name"],
    ["claim_page_name: name_taken", "name_taken"],
    ["claim_page_name: rename_limit", "rename_limit"],
    ["permission denied", "not_admitted"],
  ])("maps %s", async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const { error } = await claimLandingPageName("grace-fit");
    expect(error?.code).toBe(code);
    expect(error?.message).toBe(`pageNames.errors.${code}`);
  });
});

describe("publishLandingPage and unpublishLandingPage", () => {
  // 24.11: publishing reads the page status first (the admission), so the mock answers each function by name
  const publishAnswers = (answer: { data: unknown; error: unknown }) =>
    rpc.mockImplementation(async (fn: string) => (fn === "get_gym_page_status" ? { data: status, error: null } : answer));

  it("publishes with the offered template and trusts the server result", async () => {
    publishAnswers({ data: { published: true, missing: [] }, error: null });
    expect((await publishLandingPage("classic")).data).toEqual({ published: true, missing: [] });
    expect(rpc).toHaveBeenCalledWith("publish_gym_page", { p_gym_id: GYM, p_template: "classic" });
  });

  it("a failed gate is a result: published false with the missing codes", async () => {
    publishAnswers({ data: { published: false, missing: ["no_banner", "about_short"] }, error: null });
    const { data, error } = await publishLandingPage("classic");
    expect(error).toBeNull();
    expect(data).toEqual({ published: false, missing: ["no_banner", "about_short"] });
  });

  it("a template the dashboard does not offer never reaches the database", async () => {
    const { error } = await publishLandingPage("bold");
    expect(error?.code).toBe("invalid_template");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("taken_down is the typed refusal", async () => {
    publishAnswers({ data: null, error: { message: "publish_gym_page: taken_down" } });
    const { error } = await publishLandingPage("classic");
    expect(error).toEqual({ code: "taken_down", message: "pagePublish.errors.taken_down" });
  });

  it("unpublish reports whether a live page went offline", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await unpublishLandingPage()).data).toEqual({ wasLive: true });
    expect(rpc).toHaveBeenCalledWith("unpublish_gym_page", { p_gym_id: GYM });
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await unpublishLandingPage()).data).toEqual({ wasLive: false });
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect((await unpublishLandingPage()).error?.code).toBe("not_admitted");
  });
});

describe("Story 24.11: republishing after the images were purged", () => {
  const m167 = readFileSync(join(migrations, "0167_page_takedown_reports_media_purge.sql"), "utf8");
  const takenDownStatus = { ...status, state: "taken_down", taken_down_reason: "privacy", appeal: { state: "none", submitted_at: null, decided_at: null, decision_reason: null } };
  function script(published: unknown, statusOver: Record<string, unknown> = {}, order: string[] = []) {
    rpc.mockImplementation(async (fn: string) => {
      order.push(fn);
      if (fn === "get_gym_page_status") return { data: { ...status, ...statusOver }, error: null };
      if (fn === "publish_gym_page") return typeof published === "object" && published && "error" in (published as object) ? published : { data: published, error: null };
      return { data: null, error: null };
    });
    return order;
  }
  const rebuilt = (ids: string[] = ["m1"]) => ({ ok: true as const, ids, commit, discard });

  it("rebuilds the purged images BEFORE it asks the database to publish, and clears the purge marks only AFTER it succeeded", async () => {
    const order = script({ published: true, missing: [] });
    rebuildPurgedMedia.mockImplementationOnce(async () => (order.push("rebuild"), rebuilt()));
    commit.mockImplementationOnce(async () => (order.push("commit"), true));
    expect((await publishLandingPage("classic")).data).toEqual({ published: true, missing: [] });
    expect(order).toEqual(["get_gym_page_status", "rebuild", "publish_gym_page", "commit"]);
    expect(rebuildPurgedMedia).toHaveBeenCalledWith(GYM);
    expect(discard).not.toHaveBeenCalled();
  });

  it("a failed rebuild blocks the publish with its own typed error and never calls publish_gym_page", async () => {
    const order = script({ published: true, missing: [] });
    rebuildPurgedMedia.mockResolvedValueOnce({ ok: false });
    const { data, error } = await publishLandingPage("classic");
    expect(data).toBeNull();
    expect(error).toEqual({ code: "rederive_failed", message: "pagePublish.errors.rederive_failed" });
    expect(order).not.toContain("publish_gym_page");
  });

  it("when the publish does not happen (a refusal, a gate failure, an unexpected answer, a throw) the images written in this attempt are removed and nothing is committed", async () => {
    rebuildPurgedMedia.mockResolvedValue(rebuilt());
    script({ error: { message: "publish_gym_page: taken_down" } });
    expect((await publishLandingPage("classic")).error?.code).toBe("taken_down");
    script({ published: false, missing: ["no_banner"] });
    expect((await publishLandingPage("classic")).data).toEqual({ published: false, missing: ["no_banner"] });
    script({ nonsense: true });
    expect((await publishLandingPage("classic")).error?.code).toBe("load_failed");
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_gym_page_status") return { data: status, error: null };
      throw new Error("network");
    });
    await expect(publishLandingPage("classic")).rejects.toThrow("network");
    expect(discard).toHaveBeenCalledTimes(4);
    expect(commit).not.toHaveBeenCalled();
  });

  it("a publish that succeeded but whose marks could not be cleared still reports the publish (logged)", async () => {
    script({ published: true, missing: [] });
    rebuildPurgedMedia.mockResolvedValueOnce(rebuilt());
    commit.mockResolvedValueOnce(false);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await publishLandingPage("classic")).data).toEqual({ published: true, missing: [] });
    expect(log).toHaveBeenCalledWith("[landing-page] the page is published but its purge marks could not be cleared");
    log.mockRestore();
  });

  it("does not rebuild anything for a page that cannot pass the gate, or one that is taken down: the database answers", async () => {
    script({ published: false, missing: ["no_banner"] }, { missing: ["no_banner"] });
    expect((await publishLandingPage("classic")).data).toEqual({ published: false, missing: ["no_banner"] });
    rpc.mockImplementation(async (fn: string) =>
      fn === "get_gym_page_status" ? { data: takenDownStatus, error: null } : { data: null, error: { message: "publish_gym_page: taken_down" } },
    );
    expect((await publishLandingPage("classic")).error?.code).toBe("taken_down");
    expect(rebuildPurgedMedia).not.toHaveBeenCalled();
  });

  it("an unreadable status (an error, or a shape that does not parse) fails closed with rederive_failed and publishes nothing", async () => {
    const order: string[] = [];
    rpc.mockImplementation(async (fn: string) => (order.push(fn), fn === "get_gym_page_status" ? { data: null, error: { message: "permission denied" } } : { data: { published: true, missing: [] }, error: null }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await publishLandingPage("classic")).error?.code).toBe("rederive_failed");
    rpc.mockImplementation(async (fn: string) => (order.push(fn), fn === "get_gym_page_status" ? { data: { state: "ready" }, error: null } : { data: { published: true, missing: [] }, error: null }));
    expect((await publishLandingPage("classic")).error?.code).toBe("rederive_failed");
    log.mockRestore();
    expect(order).not.toContain("publish_gym_page");
    expect(rebuildPurgedMedia).not.toHaveBeenCalled();
  });

  it("the page-media RPCs the rebuild uses exist and are service-role only", () => {
    for (const fn of ["page_media_rederive_list(uuid)", "page_media_rederive_done(uuid, uuid[])"]) {
      expect(m167).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
      expect(m167).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

describe("Story 24.11: the Owner's appeal", () => {
  const m167 = readFileSync(join(migrations, "0167_page_takedown_reports_media_purge.sql"), "utf8");

  it.each([
    ["reason_required", "submit_page_appeal: reason_required"],
    ["not_taken_down", "submit_page_appeal: not_taken_down"],
    ["appeal_open", "submit_page_appeal: appeal_open"],
    ["appeal_decided", "submit_page_appeal: appeal_decided"],
  ] as const)("%s is the real message of the migration and maps to its code", (code, message) => {
    expect(m167).toContain(`raise exception '${message}'`);
    expect(pageAppealCodeFromDbError({ message })).toBe(code);
  });

  it("permission denied is exactly not_admitted; a privilege fault is not", () => {
    expect(pageAppealCodeFromDbError({ message: "permission denied" })).toBe("not_admitted");
    expect(pageAppealCodeFromDbError({ message: "permission denied for table x" })).toBeNull();
    expect(pageAppealCodeFromDbError({ message: "submit_page_appeal: other" })).toBeNull();
    expect(pageAppealCodeFromDbError(null)).toBeNull();
  });

  it("sends the trimmed reason to submit_page_appeal for an Owner", async () => {
    rpc.mockResolvedValue({ data: { id: "x", state: "open" }, error: null });
    expect((await submitLandingPageAppeal("  We own the mark  ")).data).toEqual({ state: "open" });
    expect(rpc).toHaveBeenCalledWith("submit_page_appeal", { p_reason: "We own the mark" });
  });

  it("refuses an empty or over-long reason before the database, and a non-Owner before the database too", async () => {
    expect((await submitLandingPageAppeal("   ")).error?.code).toBe("reason_required");
    expect((await submitLandingPageAppeal("x".repeat(501))).error?.code).toBe("reason_required");
    getClaims.mockResolvedValue({ data: { claims: { gym_id: GYM, app_role: "supervisor" } }, error: null });
    expect((await submitLandingPageAppeal("A reason")).error?.code).toBe("not_admitted");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("types the database refusals and maps anything else through the shared mapper", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "submit_page_appeal: appeal_decided" } });
    expect((await submitLandingPageAppeal("A reason")).error).toEqual({ code: "appeal_decided", message: "pageAppeal.errors.appeal_decided" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await submitLandingPageAppeal("A reason")).error?.message).toBe("mapped");
  });
});
