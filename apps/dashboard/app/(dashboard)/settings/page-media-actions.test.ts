/**
 * Story 24.6 review patch: the Server Action wrappers are the only client-reachable entry points to the page media service.
 * The service tests pass `attested` as a typed value, so the FormData mapping is pinned here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadPageMedia = vi.fn();
const preparePageLogo = vi.fn();
const deletePageMedia = vi.fn();

vi.mock("@/services/page-media", () => ({
  uploadPageMedia: (...a: unknown[]) => uploadPageMedia(...a),
  preparePageLogo: (...a: unknown[]) => preparePageLogo(...a),
  deletePageMedia: (...a: unknown[]) => deletePageMedia(...a),
}));

import { deletePageMediaAction, preparePageLogoAction, uploadPageMediaAction } from "./page-media-actions";

const GYM = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";

function form(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadPageMedia.mockResolvedValue({ data: null, error: null });
  preparePageLogo.mockResolvedValue({ data: null, error: null });
  deletePageMedia.mockResolvedValue({ error: null });
});

describe("uploadPageMediaAction", () => {
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

  it("forwards gymId, kind and the file; attested only when the field is the string true", async () => {
    await uploadPageMediaAction(form({ gymId: GYM, kind: "gallery", attested: "true", file }));
    const arg = uploadPageMedia.mock.calls[0][0];
    expect(arg.gymId).toBe(GYM);
    expect(arg.kind).toBe("gallery");
    expect(arg.attested).toBe(true);
    expect(arg.file).toBeInstanceOf(Blob);
  });

  it("an absent attested field reaches the service as false", async () => {
    await uploadPageMediaAction(form({ gymId: GYM, kind: "gallery", file }));
    expect(uploadPageMedia.mock.calls[0][0].attested).toBe(false);
  });

  it.each(["false", "", "1", "TRUE", "yes"])("attested=%j reaches the service as false", async (value) => {
    await uploadPageMediaAction(form({ gymId: GYM, kind: "gallery", attested: value, file }));
    expect(uploadPageMedia.mock.calls[0][0].attested).toBe(false);
  });

  it("a text field named file becomes null, never a string", async () => {
    await uploadPageMediaAction(form({ gymId: GYM, kind: "gallery", attested: "true", file: "not-a-file" }));
    expect(uploadPageMedia.mock.calls[0][0].file).toBeNull();
  });

  it("a missing file becomes null", async () => {
    await uploadPageMediaAction(form({ gymId: GYM, kind: "gallery", attested: "true" }));
    expect(uploadPageMedia.mock.calls[0][0].file).toBeNull();
  });

  it("a missing gymId becomes an empty string, not a throw", async () => {
    await uploadPageMediaAction(form({ kind: "gallery", attested: "true", file }));
    expect(uploadPageMedia.mock.calls[0][0].gymId).toBe("");
  });

  it("a File value for gymId is not accepted as a string id", async () => {
    await uploadPageMediaAction(form({ gymId: file, kind: "gallery", attested: "true", file }));
    expect(uploadPageMedia.mock.calls[0][0].gymId).toBe("");
  });

  it("returns what the service returns", async () => {
    uploadPageMedia.mockResolvedValue({ data: { id: MEDIA, derivativeKey: "k.webp" }, error: null });
    expect(await uploadPageMediaAction(form({ gymId: GYM, kind: "banner", attested: "true", file }))).toEqual({
      data: { id: MEDIA, derivativeKey: "k.webp" },
      error: null,
    });
  });
});

describe("preparePageLogoAction", () => {
  it("passes true only for a real boolean true", async () => {
    await preparePageLogoAction(GYM, true);
    expect(preparePageLogo).toHaveBeenLastCalledWith(GYM, true);
  });

  it("anything else is passed on as false", async () => {
    await preparePageLogoAction(GYM, false);
    expect(preparePageLogo).toHaveBeenLastCalledWith(GYM, false);
    await preparePageLogoAction(GYM, "true" as unknown as boolean);
    expect(preparePageLogo).toHaveBeenLastCalledWith(GYM, false);
    await preparePageLogoAction(GYM, undefined as unknown as boolean);
    expect(preparePageLogo).toHaveBeenLastCalledWith(GYM, false);
  });
});

describe("deletePageMediaAction", () => {
  it("forwards the media id", async () => {
    await deletePageMediaAction(MEDIA);
    expect(deletePageMedia).toHaveBeenCalledWith(MEDIA);
  });
});
