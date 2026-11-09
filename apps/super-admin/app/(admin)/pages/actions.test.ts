import { beforeEach, describe, expect, it, vi } from "vitest";

let allowed = true;
let stepUp = true;
const rpc = vi.fn();
const consumeStepUp = vi.fn(async () => stepUp);

vi.mock("@/lib/authz-action", () => ({
  authorizeOrRedirect: vi.fn(async () =>
    allowed ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "denied" }, reason: "x" },
  ),
}));
vi.mock("@/lib/authz", () => ({ STEP_UP_REQUIRED_CODE: "step_up_required", consumeStepUp: (...a: unknown[]) => (consumeStepUp as (...x: unknown[]) => Promise<boolean>)(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

const GYM = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "33333333-3333-4333-8333-333333333333";
const AP = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  allowed = true;
  stepUp = true;
  rpc.mockReset();
  consumeStepUp.mockClear();
});

describe("every action is behind the gate", () => {
  it("a denied caller reaches no database call and no step-up", async () => {
    allowed = false;
    const a = await import("./actions");
    const results = await Promise.all([
      a.listPageReports(),
      a.listPageAppeals(),
      a.getGymPagePanel(GYM),
      a.takeDownPage({ gymId: GYM, reason: "privacy" }),
      a.liftPageTakedown({ gymId: GYM, reason: "a reason" }),
      a.dismissPageReports({ reportIds: [R1], note: "a note" }),
      a.closePageReportsTakenDown({ reportIds: [R1] }),
      a.decidePageAppeal({ id: AP, gymId: GYM, decision: "uphold", reason: "a reason" }),
    ]);
    for (const r of results) expect(r.error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
    expect(consumeStepUp).not.toHaveBeenCalled();
  });
});

describe("the lists", () => {
  it("maps the report queue", async () => {
    rpc.mockResolvedValue({
      data: [{ id: R1, gym_id: GYM, gym_name: "Iron Gym", page_name: "iron-gym", reason: "privacy", details: "It shows my address", created_at: "2026-11-02T10:00:00Z", due_at: "2026-11-09T10:00:00Z", overdue: true, page_taken_down: false }],
      error: null,
    });
    const { listPageReports } = await import("./actions");
    const res = await listPageReports();
    expect(rpc).toHaveBeenCalledWith("list_page_reports");
    expect(res.data).toEqual([{ id: R1, gymId: GYM, gymName: "Iron Gym", pageName: "iron-gym", reason: "privacy", details: "It shows my address", createdAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-09T10:00:00Z", overdue: true, pageTakenDown: false }]);
  });
  it("maps the appeals", async () => {
    rpc.mockResolvedValue({
      data: [{ id: AP, gym_id: GYM, gym_name: "Iron Gym", page_name: "iron-gym", takedown_reason: "other", takedown_note: "n", taken_down_at: "2026-11-01T00:00:00Z", appeal_reason: "We own it", appealed_at: "2026-11-02T00:00:00Z", decision: null, decision_reason: null, decided_at: null, takedown_lifted: false }],
      error: null,
    });
    const { listPageAppeals } = await import("./actions");
    const res = await listPageAppeals();
    expect(res.data?.[0]).toMatchObject({ id: AP, gymId: GYM, takedownReason: "other", takedownNote: "n", appealReason: "We own it", decision: null, takedownLifted: false });
  });
  it("a database error is mapped, not thrown", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listPageReports } = await import("./actions");
    expect((await listPageReports()).error?.message).toBe("mapped");
  });
});

describe("takeDownPage", () => {
  it("validates before anything else: a reason code, and a note for 'other'", async () => {
    const { takeDownPage } = await import("./actions");
    expect((await takeDownPage({ gymId: GYM, reason: "spam" })).error?.code).toBe("validation_error");
    expect((await takeDownPage({ gymId: GYM, reason: "other" })).error?.message).toBe("pages.errors.note_required");
    expect((await takeDownPage({ gymId: "nope", reason: "privacy" })).error?.code).toBe("validation_error");
    expect(consumeStepUp).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("asks for the step-up first, bound to the gym, and does not call the database without it", async () => {
    stepUp = false;
    const { takeDownPage } = await import("./actions");
    const res = await takeDownPage({ gymId: GYM, reason: "privacy" });
    expect(res.error?.code).toBe("step_up_required");
    expect(consumeStepUp).toHaveBeenCalledWith("sa-1", "take_down_gym_page", GYM);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("takes the page down, then closes the named reports as taken_down", async () => {
    rpc.mockResolvedValueOnce({ data: { taken_down: true, takedown_id: "td-1" }, error: null }).mockResolvedValue({ data: {}, error: null });
    const { takeDownPage } = await import("./actions");
    const res = await takeDownPage({ gymId: GYM, reason: "impersonation", note: "  Pretends to be a bank ", reportIds: [R1, R2] });
    expect(rpc).toHaveBeenNthCalledWith(1, "take_down_gym_page", { p_gym_id: GYM, p_reason: "impersonation", p_note: "Pretends to be a bank" });
    expect(rpc).toHaveBeenNthCalledWith(2, "close_page_report", { p_id: R1, p_outcome: "taken_down" });
    expect(rpc).toHaveBeenNthCalledWith(3, "close_page_report", { p_id: R2, p_outcome: "taken_down" });
    expect(res).toEqual({ data: { takedownId: "td-1", reportsClosed: 2 }, error: null });
  });
  it("sends no note when none was typed, and gives each typed refusal its own copy", async () => {
    const { takeDownPage } = await import("./actions");
    rpc.mockResolvedValueOnce({ data: { takedown_id: "x" }, error: null });
    await takeDownPage({ gymId: GYM, reason: "privacy" });
    expect(rpc).toHaveBeenCalledWith("take_down_gym_page", { p_gym_id: GYM, p_reason: "privacy" });
    for (const code of ["no_page", "already_taken_down", "invalid_reason", "note_required", "note_invalid"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: `take_down_gym_page: ${code}` } });
      expect((await takeDownPage({ gymId: GYM, reason: "privacy" })).error).toEqual({ code, message: `pages.errors.${code}` });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    expect((await takeDownPage({ gymId: GYM, reason: "privacy" })).error?.message).toBe("mapped");
  });
});

describe("liftPageTakedown", () => {
  it("needs a reason of 3 to 500 characters and the step-up, then lifts", async () => {
    const { liftPageTakedown } = await import("./actions");
    expect((await liftPageTakedown({ gymId: GYM, reason: "ab" })).error?.message).toBe("pages.errors.reason_required");
    stepUp = false;
    expect((await liftPageTakedown({ gymId: GYM, reason: "A good reason" })).error?.code).toBe("step_up_required");
    expect(consumeStepUp).toHaveBeenCalledWith("sa-1", "lift_gym_page_takedown", GYM);
    expect(rpc).not.toHaveBeenCalled();
    stepUp = true;
    rpc.mockResolvedValue({ data: { lifted: true }, error: null });
    const res = await liftPageTakedown({ gymId: GYM, reason: "  A good reason " });
    expect(rpc).toHaveBeenCalledWith("lift_gym_page_takedown", { p_gym_id: GYM, p_reason: "A good reason" });
    expect(res.data).toEqual({ lifted: true });
  });
  it("types its refusals", async () => {
    const { liftPageTakedown } = await import("./actions");
    rpc.mockResolvedValue({ data: null, error: { message: "lift_gym_page_takedown: not_taken_down" } });
    expect((await liftPageTakedown({ gymId: GYM, reason: "A good reason" })).error?.code).toBe("not_taken_down");
  });
});

describe("dismissing and closing reports", () => {
  it("a note over 500 characters is refused before the database; the database's own note_invalid is typed", async () => {
    const { dismissPageReports } = await import("./actions");
    expect((await dismissPageReports({ reportIds: [R1], note: "x".repeat(501) })).error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "close_page_report: note_invalid" } });
    expect((await dismissPageReports({ reportIds: [R1], note: "A fine note" })).error).toEqual({ code: "note_invalid", message: "pages.errors.note_invalid" });
  });
  it("dismisses each named report with the one note", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { dismissPageReports } = await import("./actions");
    expect((await dismissPageReports({ reportIds: [R1, R2], note: "ab" })).error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
    const res = await dismissPageReports({ reportIds: [R1, R2], note: " Checked, it is theirs " });
    expect(rpc).toHaveBeenCalledWith("close_page_report", { p_id: R1, p_outcome: "dismissed", p_note: "Checked, it is theirs" });
    expect(rpc).toHaveBeenCalledWith("close_page_report", { p_id: R2, p_outcome: "dismissed", p_note: "Checked, it is theirs" });
    expect(res.data).toEqual({ closed: 2 });
  });
  it("stops at the first refusal and says how many were closed", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: null, error: { message: "close_page_report: not_open" } });
    const { dismissPageReports } = await import("./actions");
    const res = await dismissPageReports({ reportIds: [R1, R2], note: "A fine note" });
    expect(res.data).toEqual({ closed: 1 });
    expect(res.error).toEqual({ code: "not_open", message: "pages.errors.not_open" });
  });
  it("closes the reports of an already-taken-down page as taken_down", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { closePageReportsTakenDown } = await import("./actions");
    expect((await closePageReportsTakenDown({ reportIds: [] })).error?.code).toBe("validation_error");
    expect((await closePageReportsTakenDown({ reportIds: [1] })).error?.code).toBe("validation_error");
    expect((await closePageReportsTakenDown({ reportIds: [R1] })).data).toEqual({ closed: 1 });
    expect(rpc).toHaveBeenCalledWith("close_page_report", { p_id: R1, p_outcome: "taken_down" });
  });
});

describe("decidePageAppeal", () => {
  it("uphold needs a reason and no step-up", async () => {
    rpc.mockResolvedValue({ data: { id: AP, decision: "uphold" }, error: null });
    const { decidePageAppeal } = await import("./actions");
    expect((await decidePageAppeal({ id: AP, gymId: GYM, decision: "uphold", reason: "no" })).error?.code).toBe("validation_error");
    expect((await decidePageAppeal({ id: AP, decision: "uphold", reason: "A fine reason" })).error?.code).toBe("validation_error");
    const res = await decidePageAppeal({ id: AP, gymId: GYM, decision: "uphold", reason: " The page copies a bank " });
    expect(consumeStepUp).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("decide_page_appeal", { p_id: AP, p_decision: "uphold", p_reason: "The page copies a bank" });
    expect(res.data).toEqual({ decision: "uphold" });
  });
  it("lift reads the appeal's own gym from the database, binds the step-up to it, and refuses a gym that does not match", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: AP, gym_id: GYM }], error: null }).mockResolvedValue({ data: { id: AP, decision: "lift" }, error: null });
    const { decidePageAppeal } = await import("./actions");
    const res = await decidePageAppeal({ id: AP, gymId: GYM, decision: "lift", reason: "The mark is theirs" });
    expect(consumeStepUp).toHaveBeenCalledWith("sa-1", "lift_gym_page_takedown", GYM);
    expect(rpc).toHaveBeenLastCalledWith("decide_page_appeal", { p_id: AP, p_decision: "lift", p_reason: "The mark is theirs" });
    expect(res.data).toEqual({ decision: "lift" });

    rpc.mockReset();
    consumeStepUp.mockClear();
    rpc.mockResolvedValueOnce({ data: [{ id: AP, gym_id: "55555555-5555-4555-8555-555555555555" }], error: null });
    const bad = await decidePageAppeal({ id: AP, gymId: GYM, decision: "lift", reason: "The mark is theirs" });
    expect(bad.error?.code).toBe("not_found");
    expect(consumeStepUp).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("lift without the step-up never calls decide_page_appeal", async () => {
    stepUp = false;
    rpc.mockResolvedValueOnce({ data: [{ id: AP, gym_id: GYM }], error: null });
    const { decidePageAppeal } = await import("./actions");
    const res = await decidePageAppeal({ id: AP, gymId: GYM, decision: "lift", reason: "The mark is theirs" });
    expect(res.error?.code).toBe("step_up_required");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("getGymPagePanel", () => {
  it("reads the status and the page name and never the internal note", async () => {
    const snapshot = { name: "Iron", default_language: "en" };
    rpc.mockImplementation(async (fn: string) =>
      fn === "get_gym_page_status"
        ? {
            data: { state: "taken_down", template: "classic", published_at: null, unpublished_reasons: [], missing: [], bad_text_fields: [], about_min_chars: 100, languages: [], media: [], snapshot, taken_down_reason: "privacy", appeal: { state: "open", submitted_at: "2026-11-02T10:00:00Z", decided_at: null, decision_reason: null } },
            error: null,
          }
        : { data: { name: "iron-gym", state: "active", pending_name: null, completed_renames: 0, redirects: [] }, error: null },
    );
    const { getGymPagePanel } = await import("./actions");
    const res = await getGymPagePanel(GYM);
    expect(res.data).toEqual({ state: "taken_down", reason: "privacy", appeal: { state: "open", submitted_at: "2026-11-02T10:00:00Z", decided_at: null, decision_reason: null }, pageName: "iron-gym" });
  });
});
