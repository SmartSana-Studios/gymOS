// Story 24.6: page media pipeline. Real sharp, mocked Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { jpegWithMetadata, SECRET_TEXT, XMP_MARK } from "./page-media.fixture";

const GYM = "11111111-1111-4111-8111-111111111111";

const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const download = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: { from: (bucket: string) => ({ upload: (...a: unknown[]) => upload(bucket, ...a), remove: (...a: unknown[]) => remove(bucket, ...a), download: (...a: unknown[]) => download(bucket, ...a) }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { deletePageMedia, gymLogoObjectPath, pageMediaCodeFromDbError, preparePageLogo, processPageImage, uploadPageMedia } from "./page-media";

function file(buf: Buffer, name = "x.jpg", type = "image/jpeg") {
  return new File([new Uint8Array(buf)], name, { type });
}
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#123456" } }).png().toBuffer();

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (_n: string, a: { p_dry_run?: boolean }) => ({ data: a?.p_dry_run === false ? "22222222-2222-4222-8222-222222222222" : null, error: null }));
  upload.mockResolvedValue({ data: {}, error: null });
  remove.mockResolvedValue({ data: [], error: null });
});

const okInput = async (over: Record<string, unknown> = {}) => ({
  gymId: GYM,
  kind: "gallery",
  attested: true,
  file: file(await jpegWithMetadata(200, 100, 6)),
  ...over,
});
const uploads = () => upload.mock.calls;

describe("derivative: metadata and orientation", () => {
  it("strips GPS EXIF, XMP, IPTC and comments, and applies the orientation", async () => {
    const original = await jpegWithMetadata(200, 100, 6);
    // the fixture really carries the metadata (otherwise the assertions below prove nothing)
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp ?? before.xmpAsString).toBeDefined();
    expect(before.iptc).toBeDefined();
    expect(before.orientation).toBe(6);
    expect(original.includes(Buffer.from(XMP_MARK))).toBe(true);
    expect(original.includes(Buffer.from("Photoshop 3.0"))).toBe(true);
    expect(original.includes(Buffer.from(SECRET_TEXT))).toBe(true);

    const { derivative, format } = await processPageImage(original, "gallery");
    expect(format).toBe("jpeg");
    const after = await sharp(derivative).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // upright: raw 200x100 with orientation 6 is 100x200 once rotated
    expect([after.width, after.height]).toEqual([100, 200]);
    for (const needle of ["Exif", XMP_MARK, "Photoshop 3.0", "8BIM", "GPS", SECRET_TEXT, "xmpmeta"]) {
      expect(derivative.includes(Buffer.from(needle))).toBe(false);
    }
    expect(derivative.subarray(0, 4).toString()).toBe("RIFF");
    expect(derivative.subarray(8, 12).toString()).toBe("WEBP");
  });

  it("resizes to at most 1600 px (512 px for the logo) and never enlarges", async () => {
    const big = await png(3000, 1000);
    const g = await sharp((await processPageImage(big, "gallery")).derivative).metadata();
    expect([g.width, g.height]).toEqual([1600, 533]);
    const l = await sharp((await processPageImage(big, "logo")).derivative).metadata();
    expect(Math.max(l.width!, l.height!)).toBe(512);
    const small = await sharp((await processPageImage(await png(40, 30), "banner")).derivative).metadata();
    expect([small.width, small.height]).toEqual([40, 30]);
  });
});

describe("content, not label", () => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  for (const [name, bytes] of [["GIF", gif], ["SVG", svg], ["PDF", pdf], ["empty", Buffer.alloc(0)], ["garbage", Buffer.from("not an image at all")]] as const) {
    it(`${name} renamed .jpg with an image/jpeg label stores nothing`, async () => {
      const r = await uploadPageMedia({ gymId: GYM, kind: "gallery", attested: true, file: file(bytes, "photo.jpg", "image/jpeg") });
      expect(r.error?.code).toBe("unsupported_type");
      expect(r.data).toBeNull();
      expect(uploads()).toHaveLength(0);
      expect(rpc.mock.calls.every(([, a]) => a.p_dry_run === true)).toBe(true);
    });
  }

  it("accepts a PNG labelled as text/plain with no extension (content decides)", async () => {
    const r = await uploadPageMedia({ gymId: GYM, kind: "gallery", attested: true, file: file(await png(50, 50), "noext", "text/plain") });
    expect(r.error).toBeNull();
    expect(uploads()).toHaveLength(2);
  });
});

describe("bounds", () => {
  it("over 4 MiB is too_large and nothing is stored", async () => {
    const r = await uploadPageMedia({ gymId: GYM, kind: "gallery", attested: true, file: file(Buffer.alloc(4 * 1024 * 1024 + 1, 1)) });
    expect(r.error?.code).toBe("too_large");
    expect(uploads()).toHaveLength(0);
  });
  it("4 MiB + 1 is too_large, while exactly 4 MiB passes the size check and fails only on content", async () => {
    await expect(processPageImage(Buffer.alloc(4 * 1024 * 1024 + 1), "gallery")).rejects.toMatchObject({ code: "too_large" });
    await expect(processPageImage(Buffer.alloc(4 * 1024 * 1024), "gallery")).rejects.toMatchObject({ code: "unsupported_type" });
  });
  it("a canvas past the decoder pixel limit (not just a long side) is too_many_pixels", async () => {
    // 5000x5000 is under 4 MiB as a flat PNG and trips sharp's limitInputPixels, whose message processPageImage matches on.
    const big = await png(5000, 5000);
    expect(big.length).toBeLessThan(4 * 1024 * 1024);
    await expect(processPageImage(big, "gallery")).rejects.toMatchObject({ code: "too_many_pixels" });
  });
  it("over 4096 px on the longest side is too_many_pixels", async () => {
    const r = await uploadPageMedia({ gymId: GYM, kind: "gallery", attested: true, file: file(await png(4097, 8), "w.png", "image/png") });
    expect(r.error?.code).toBe("too_many_pixels");
    expect(uploads()).toHaveLength(0);
  });
  it("4096 px exactly is accepted", async () => {
    await expect(processPageImage(await png(4096, 8), "gallery")).resolves.toBeDefined();
  });
});

describe("happy path", () => {
  it("stores the original privately and a WebP derivative under a random key without the gym id, then registers", async () => {
    const input = await okInput();
    const r = await uploadPageMedia(input as never);
    expect(r.error).toBeNull();
    const [src, derived] = uploads();
    expect(src[0]).toBe("gym-page-media-src");
    expect(derived[0]).toBe("gym-page-media");
    expect(src[1]).toMatch(new RegExp(`^${GYM}/[0-9a-f-]{36}$`));
    expect(derived[1]).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect(derived[1]).not.toContain(GYM);
    expect(derived[3]).toMatchObject({ contentType: "image/webp", cacheControl: "300", upsert: false });
    expect(src[3]).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(Buffer.isBuffer(derived[2])).toBe(true);
    expect((derived[2] as Buffer).includes(Buffer.from("Exif"))).toBe(false);
    // dry run first, real call last, same arguments plus attestation
    expect(rpc.mock.calls.map(([n, a]) => [n, a.p_dry_run])).toEqual([["register_page_media", true], ["register_page_media", false]]);
    const real = rpc.mock.calls[1][1];
    expect(real).toMatchObject({ p_gym_id: GYM, p_kind: "gallery", p_attested: true, p_original_key: src[1], p_derivative_key: derived[1] });
    expect(r.data?.derivativeKey).toBe(derived[1]);
  });
  it("the rpc id is returned", async () => {
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.data?.id).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("refusals before any storage write", () => {
  it.each([[false], [undefined], ["true"], [1]])("attestation %s is refused without touching the database", async (attested) => {
    const r = await uploadPageMedia((await okInput({ attested })) as never);
    expect(r.error?.code).toBe("attestation_required");
    expect(rpc).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(0);
  });
  it("a caller the database does not admit is not_admitted and the file is never read", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const f = file(await png(10, 10));
    const spy = vi.spyOn(f, "arrayBuffer");
    const r = await uploadPageMedia({ gymId: GYM, kind: "gallery", attested: true, file: f });
    expect(r.error?.code).toBe("not_admitted");
    expect(spy).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(0);
  });
  it("a suspended gym is not_admitted", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: `register_page_media: gym ${GYM} is not active` } });
    expect((await uploadPageMedia((await okInput()) as never)).error?.code).toBe("not_admitted");
  });
  it("the 13th gallery image is limit_reached", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "register_page_media: limit_reached" } });
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.error?.code).toBe("limit_reached");
    expect(uploads()).toHaveLength(0);
  });
  it("an unknown kind or a non-uuid gym id is refused", async () => {
    expect((await uploadPageMedia((await okInput({ kind: "avatar" })) as never)).error).not.toBeNull();
    expect((await uploadPageMedia((await okInput({ gymId: "not-a-uuid" })) as never)).error?.code).toBe("not_admitted");
    expect(uploads()).toHaveLength(0);
  });
});

describe("register fails after upload", () => {
  it("removes both objects and returns a typed error", async () => {
    rpc.mockImplementation(async (_n, a) => (a.p_dry_run ? { data: null, error: null } : { data: null, error: { message: "register_page_media: limit_reached" } }));
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.error?.code).toBe("limit_reached");
    const [src, derived] = uploads();
    expect(remove).toHaveBeenCalledWith("gym-page-media-src", [src[1]]);
    expect(remove).toHaveBeenCalledWith("gym-page-media", [derived[1]]);
  });
  it("an unexpected register failure also removes both objects", async () => {
    rpc.mockImplementation(async (_n, a) => (a.p_dry_run ? { data: null, error: null } : { data: null, error: { message: "boom" } }));
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.error?.code).toBe("upload_failed");
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("a failed derivative upload removes the original", async () => {
    upload.mockImplementation(async (bucket: string) => (bucket === "gym-page-media" ? { error: { message: "x" } } : { error: null }));
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.error?.code).toBe("upload_failed");
    expect(remove).toHaveBeenCalledWith("gym-page-media-src", expect.any(Array));
    expect(remove).toHaveBeenCalledWith("gym-page-media", [expect.stringMatching(/\.webp$/)]);
    expect(rpc.mock.calls.every(([, a]) => a.p_dry_run === true)).toBe(true);
  });
  it("a derivative upload that rejects (throws) still removes both objects", async () => {
    upload.mockImplementation(async (bucket: string) => {
      if (bucket === "gym-page-media") throw new Error("socket hang up");
      return { error: null };
    });
    const r = await uploadPageMedia((await okInput()) as never);
    expect(r.error?.code).toBe("upload_failed");
    expect(remove).toHaveBeenCalledWith("gym-page-media-src", expect.any(Array));
    expect(remove).toHaveBeenCalledWith("gym-page-media", [expect.stringMatching(/\.webp$/)]);
  });
});

describe("logo preparation", () => {
  it("parses only this gym's gym-logos URLs", () => {
    const base = "http://127.0.0.1:54321/storage/v1/object/public/gym-logos/";
    expect(gymLogoObjectPath(`${base}${GYM}/logo.png`, GYM)).toBe(`${GYM}/logo.png`);
    expect(gymLogoObjectPath(`${base}${GYM}/logo.png?t=1`, GYM)).toBe(`${GYM}/logo.png`);
    expect(gymLogoObjectPath(`${base}22222222-2222-4222-8222-222222222222/logo.png`, GYM)).toBeNull();
    expect(gymLogoObjectPath("https://example.com/logo.png", GYM)).toBeNull();
    expect(gymLogoObjectPath(null, GYM)).toBeNull();
    expect(gymLogoObjectPath(`${base}${GYM}/logo.png#frag`, GYM)).toBe(`${GYM}/logo.png`);
    expect(gymLogoObjectPath(`${base}${GYM}/logo.png?t=1#frag`, GYM)).toBe(`${GYM}/logo.png`);
    expect(gymLogoObjectPath(`${base}${GYM}/%E0%A4%A.png`, GYM)).toBeNull();
    // Path traversal out of this gym's folder is refused, plain and percent-encoded: this is the only guard on a service-role download.
    expect(gymLogoObjectPath(`${base}${GYM}/../22222222-2222-4222-8222-222222222222/logo.png`, GYM)).toBeNull();
    expect(gymLogoObjectPath(`${base}${GYM}/%2e%2e/22222222-2222-4222-8222-222222222222/logo.png`, GYM)).toBeNull();
    expect(gymLogoObjectPath(`${base}${GYM}%2F..%2F22222222-2222-4222-8222-222222222222%2Flogo.png`, GYM)).toBeNull();
  });
  it("re-encodes the stored logo into the new bucket as kind logo, never a raw copy", async () => {
    const logo = await jpegWithMetadata(800, 800, 1);
    maybeSingle.mockResolvedValue({ data: { logo_url: `http://h/storage/v1/object/public/gym-logos/${GYM}/logo.jpg` }, error: null });
    download.mockResolvedValue({ data: new Blob([new Uint8Array(logo)]), error: null });
    const r = await preparePageLogo(GYM, true);
    expect(r.error).toBeNull();
    expect(download).toHaveBeenCalledWith("gym-logos", `${GYM}/logo.jpg`);
    const derived = uploads().find((u) => u[0] === "gym-page-media")!;
    const meta = await sharp(derived[2] as Buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(512);
    expect(meta.exif).toBeUndefined();
    expect(derived[1]).not.toContain(GYM);
    expect(rpc.mock.calls.every(([, a]) => a.p_kind === "logo")).toBe(true);
    expect(upload.mock.calls.some((u) => u[0] === "gym-logos")).toBe(false);
  });
  it("a gym with no logo gets a typed error and nothing is stored", async () => {
    maybeSingle.mockResolvedValue({ data: { logo_url: null }, error: null });
    const r = await preparePageLogo(GYM, true);
    expect(r.error?.code).toBe("no_logo");
    expect(uploads()).toHaveLength(0);
  });
  it("is admitted by the database first: a non-admitted caller never reads the logo", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const r = await preparePageLogo(GYM, true);
    expect(r.error?.code).toBe("not_admitted");
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  it("requires the attestation", async () => {
    expect((await preparePageLogo(GYM, false)).error?.code).toBe("attestation_required");
  });
});

describe("database error mapping", () => {
  it("maps the bare RPC refusal to not_admitted", () => {
    expect(pageMediaCodeFromDbError({ message: "permission denied" })).toBe("not_admitted");
  });
  it("does not hide a Postgres privilege fault as not_admitted", () => {
    expect(pageMediaCodeFromDbError({ message: "permission denied for function register_page_media" })).toBeNull();
  });
  it("a privilege fault is logged and reported as upload_failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for table gym_page_media" } });
    expect((await deletePageMedia("22222222-2222-4222-8222-222222222222")).error?.code).toBe("upload_failed");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("delete", () => {
  it("calls the RPC only; no storage removal", async () => {
    const r = await deletePageMedia("22222222-2222-4222-8222-222222222222");
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("delete_page_media", { p_media_id: "22222222-2222-4222-8222-222222222222" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("another gym's row is not_admitted", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect((await deletePageMedia("22222222-2222-4222-8222-222222222222")).error?.code).toBe("not_admitted");
  });
});

describe("Story 24.11: rebuildPurgedMedia (republish after the purge)", () => {
  const ROW_A = { id: "aaaaaaaa-0000-4000-8000-000000000001", kind: "logo", original_key: `${GYM}/cccccccc-cccc-4ccc-8ccc-000000000001`, derivative_key: "dddddddd-dddd-4ddd-8ddd-000000000001.webp" };
  const ROW_B = { id: "aaaaaaaa-0000-4000-8000-000000000002", kind: "gallery", original_key: `${GYM}/cccccccc-cccc-4ccc-8ccc-000000000002`, derivative_key: "dddddddd-dddd-4ddd-8ddd-000000000002.webp" };

  async function withAdmin(listed: unknown, over: { done?: unknown } = {}) {
    const adminRpc = vi.fn(async (fn: string) => {
      if (fn === "page_media_rederive_list") return listed;
      if (fn === "page_media_rederive_done") return over.done ?? { data: 1, error: null };
      return { data: null, error: null };
    });
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: adminRpc,
      storage: { from: (bucket: string) => ({ upload: (...a: unknown[]) => upload(bucket, ...a), remove: (...a: unknown[]) => remove(bucket, ...a), download: (...a: unknown[]) => download(bucket, ...a) }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    } as never);
    return adminRpc;
  }
  const doneCalls = (rpcFn: ReturnType<typeof vi.fn>) => rpcFn.mock.calls.filter((c) => c[0] === "page_media_rederive_done");

  it("does nothing when no live image was purged", async () => {
    const adminRpc = await withAdmin({ data: [], error: null });
    const { rebuildPurgedMedia } = await import("./page-media");
    const r = await rebuildPurgedMedia(GYM);
    expect(r).toMatchObject({ ok: true, ids: [] });
    expect(download).not.toHaveBeenCalled();
    expect(doneCalls(adminRpc)).toHaveLength(0);
  });

  it("rebuilds each derivative from its retained original at the SAME key, stripped of metadata, and clears NO purge mark until commit()", async () => {
    const original = await jpegWithMetadata(200, 100, 6);
    download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
    const adminRpc = await withAdmin({ data: [ROW_A, ROW_B], error: null }, { done: { data: 2, error: null } });
    const { rebuildPurgedMedia } = await import("./page-media");
    const r = await rebuildPurgedMedia(GYM);
    if (!r.ok) throw new Error("not ok");
    expect(r.ids).toEqual([ROW_A.id, ROW_B.id]);
    expect(download).toHaveBeenCalledWith("gym-page-media-src", ROW_A.original_key);
    expect(upload).toHaveBeenCalledTimes(2);
    const [bucket, key, bytes, options] = upload.mock.calls[0]!;
    expect(bucket).toBe("gym-page-media");
    expect(key).toBe(ROW_A.derivative_key);
    expect(options).toMatchObject({ contentType: "image/webp", upsert: true });
    const meta = await sharp(bytes as Buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect((bytes as Buffer).includes(Buffer.from(SECRET_TEXT))).toBe(false);
    // the marks are still set: a purge tick cannot list these images while the page is not live
    expect(doneCalls(adminRpc)).toHaveLength(0);
    expect(await r.commit()).toBe(true);
    expect(doneCalls(adminRpc)).toEqual([["page_media_rederive_done", { p_gym_id: GYM, p_ids: [ROW_A.id, ROW_B.id] }]]);
  });

  it("discard() removes the derivatives written in this attempt and clears nothing", async () => {
    const original = await jpegWithMetadata(100, 100, 1);
    download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
    const adminRpc = await withAdmin({ data: [ROW_A, ROW_B], error: null });
    const { rebuildPurgedMedia } = await import("./page-media");
    const r = await rebuildPurgedMedia(GYM);
    if (!r.ok) throw new Error("not ok");
    await r.discard();
    expect(remove).toHaveBeenCalledWith("gym-page-media", [ROW_A.derivative_key, ROW_B.derivative_key]);
    expect(doneCalls(adminRpc)).toHaveLength(0);
  });

  it("a failure half way removes what this attempt already wrote and answers not ok, clearing nothing", async () => {
    const original = await jpegWithMetadata(100, 100, 1);
    download.mockResolvedValueOnce({ data: new Blob([new Uint8Array(original)]), error: null }).mockResolvedValueOnce({ data: null, error: { message: "gone" } });
    const adminRpc = await withAdmin({ data: [ROW_A, ROW_B], error: null });
    const { rebuildPurgedMedia } = await import("./page-media");
    expect(await rebuildPurgedMedia(GYM)).toEqual({ ok: false });
    expect(remove).toHaveBeenCalledWith("gym-page-media", [ROW_A.derivative_key]);
    expect(doneCalls(adminRpc)).toHaveLength(0);
  });

  it("an original that cannot be read, a failed write, a failed list and a bad gym id all answer not ok", async () => {
    download.mockResolvedValue({ data: null, error: { message: "not found" } });
    await withAdmin({ data: [ROW_A], error: null });
    const { rebuildPurgedMedia } = await import("./page-media");
    expect(await rebuildPurgedMedia(GYM)).toEqual({ ok: false });
    expect(upload).not.toHaveBeenCalled();
    const original = await jpegWithMetadata(100, 100, 1);
    download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
    upload.mockResolvedValueOnce({ data: null, error: { message: "disk" } });
    expect(await rebuildPurgedMedia(GYM)).toEqual({ ok: false });
    await withAdmin({ data: null, error: { message: "boom" } });
    expect(await rebuildPurgedMedia(GYM)).toEqual({ ok: false });
    expect(await rebuildPurgedMedia("not-a-uuid")).toEqual({ ok: false });
  });

  it("commit() retries once and reports a failure instead of throwing", async () => {
    const original = await jpegWithMetadata(100, 100, 1);
    download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
    const adminRpc = await withAdmin({ data: [ROW_A], error: null }, { done: { data: null, error: { message: "boom" } } });
    const { rebuildPurgedMedia } = await import("./page-media");
    const r = await rebuildPurgedMedia(GYM);
    if (!r.ok) throw new Error("not ok");
    expect(await r.commit()).toBe(false);
    expect(doneCalls(adminRpc)).toHaveLength(2);
  });
});
