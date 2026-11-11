import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PAGE_MEDIA_MAX_BYTES, PAGE_MEDIA_MAX_GALLERY } from "@gymos/types";

const uploadPageMediaAction = vi.fn();
const preparePageLogoAction = vi.fn();
const deletePageMediaAction = vi.fn();
vi.mock("../../page-media-actions", () => ({
  uploadPageMediaAction: (...a: unknown[]) => uploadPageMediaAction(...a),
  preparePageLogoAction: (...a: unknown[]) => preparePageLogoAction(...a),
  deletePageMediaAction: (...a: unknown[]) => deletePageMediaAction(...a),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join(",")}` : key), i18n: { language: "en" } }),
}));

import { ImagesSection } from "./ImagesSection";

const GYM = "11111111-1111-4111-8111-111111111111";
const row = (i: number, kind: "logo" | "banner" | "gallery") => ({
  id: `3fa85f64-5717-4562-b3fc-2c963f66af${String(i).padStart(2, "0")}`,
  kind,
  derivative_key: `k${i}.webp`,
  sort_order: i,
});
const gallery = (n: number) => Array.from({ length: n }, (_, i) => row(i + 10, "gallery"));

const btn = (name: string) => screen.getByText(name) as HTMLButtonElement;
const tick = () => fireEvent.click(screen.getByRole("checkbox"));

beforeEach(() => {
  vi.clearAllMocks();
  uploadPageMediaAction.mockResolvedValue({ data: { id: "x", derivativeKey: "y" }, error: null });
  preparePageLogoAction.mockResolvedValue({ data: { id: "x", derivativeKey: "y" }, error: null });
  deletePageMediaAction.mockResolvedValue({ error: null });
});

function renderImages(media = [] as ReturnType<typeof row>[], onChanged = vi.fn()) {
  return render(<ImagesSection gymId={GYM} media={media} onChanged={onChanged} onToast={vi.fn()} />);
}
function chooseFile(label: string, file: File) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("attestation", () => {
  it("every upload button is disabled until the checkbox is ticked", () => {
    renderImages();
    for (const name of ["pageEditor.images.logoUse", "pageEditor.images.bannerAdd", "pageEditor.images.galleryAdd"]) expect(btn(name).disabled).toBe(true);
    tick();
    for (const name of ["pageEditor.images.logoUse", "pageEditor.images.bannerAdd", "pageEditor.images.galleryAdd"]) expect(btn(name).disabled).toBe(false);
  });
});

describe("upload", () => {
  it("sends gymId, kind, attested and the file to the upload action", async () => {
    const onChanged = vi.fn();
    renderImages([], onChanged);
    tick();
    chooseFile("pageEditor.images.bannerChoose", new File([new Uint8Array([1, 2, 3])], "b.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(uploadPageMediaAction).toHaveBeenCalledTimes(1));
    const form = uploadPageMediaAction.mock.calls[0][0] as FormData;
    expect(form.get("gymId")).toBe(GYM);
    expect(form.get("kind")).toBe("banner");
    expect(form.get("attested")).toBe("true");
    expect(form.get("file")).toBeInstanceOf(Blob);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a gallery file goes as kind gallery", async () => {
    renderImages();
    tick();
    chooseFile("pageEditor.images.galleryChoose", new File([new Uint8Array([1])], "g.png", { type: "image/png" }));
    await waitFor(() => expect(uploadPageMediaAction).toHaveBeenCalled());
    expect((uploadPageMediaAction.mock.calls[0][0] as FormData).get("kind")).toBe("gallery");
  });

  it("a file over PAGE_MEDIA_MAX_BYTES makes no action call and says so", async () => {
    renderImages();
    tick();
    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: PAGE_MEDIA_MAX_BYTES + 1 });
    chooseFile("pageEditor.images.bannerChoose", big);
    expect((await screen.findByTestId("images-error")).textContent).toContain("pageMedia.errors.too_large");
    expect(uploadPageMediaAction).not.toHaveBeenCalled();
  });

  it("a server error is shown as returned", async () => {
    uploadPageMediaAction.mockResolvedValue({ data: null, error: { code: "limit_reached", message: "pageMedia.errors.limit_reached" } });
    renderImages();
    tick();
    chooseFile("pageEditor.images.bannerChoose", new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" }));
    expect((await screen.findByTestId("images-error")).textContent).toContain("pageMedia.errors.limit_reached");
  });
});

describe("logo from Branding", () => {
  it("prepares the logo with the attestation", async () => {
    renderImages();
    tick();
    fireEvent.click(btn("pageEditor.images.logoUse"));
    await waitFor(() => expect(preparePageLogoAction).toHaveBeenCalledWith(GYM, true));
  });

  it("no_logo shows the link to Branding in Settings", async () => {
    preparePageLogoAction.mockResolvedValue({ data: null, error: { code: "no_logo", message: "pageMedia.errors.noLogo" } });
    renderImages();
    tick();
    fireEvent.click(btn("pageEditor.images.logoUse"));
    const error = await screen.findByTestId("images-error");
    expect(error.textContent).toContain("pageMedia.errors.noLogo");
    expect(error.querySelector("a")?.getAttribute("href")).toBe("/settings");
  });
});

describe("gallery", () => {
  it("the Add gallery image button comes first and the gallery images are under it", () => {
    renderImages(gallery(3));
    const block = screen.getByTestId("images-gallery");
    const add = btn("pageEditor.images.galleryAdd");
    const list = block.querySelector("ul")!;
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(add.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // and the heading is above the button
    expect(block.querySelector("h3")!.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("each image's remove button reads just the short word, while its accessible name keeps the image number", () => {
    renderImages(gallery(2));
    const items = screen.getByTestId("images-gallery").querySelectorAll("li button");
    expect(items).toHaveLength(2);
    expect([...items].map((b) => b.textContent)).toEqual(["pageEditor.images.removeShort", "pageEditor.images.removeShort"]);
    expect([...items].map((b) => b.getAttribute("aria-label"))).toEqual(["pageEditor.images.remove|1", "pageEditor.images.remove|2"]);
  });

  it("with no images yet the button is still there, with no empty list", () => {
    renderImages([]);
    expect(btn("pageEditor.images.galleryAdd")).toBeTruthy();
    expect(screen.getByTestId("images-gallery").querySelector("ul")).toBeNull();
  });

  it("add is disabled at PAGE_MEDIA_MAX_GALLERY and says why", () => {
    renderImages(gallery(PAGE_MEDIA_MAX_GALLERY));
    tick();
    expect(btn("pageEditor.images.galleryAdd").disabled).toBe(true);
    expect(screen.getByText(`pageEditor.images.galleryFull|${PAGE_MEDIA_MAX_GALLERY}`)).toBeTruthy();
  });

  it("add is enabled one below the limit", () => {
    renderImages(gallery(PAGE_MEDIA_MAX_GALLERY - 1));
    tick();
    expect(btn("pageEditor.images.galleryAdd").disabled).toBe(false);
  });

  it("remove deletes by media id", async () => {
    const g = gallery(2);
    renderImages(g);
    fireEvent.click(screen.getByRole("button", { name: "pageEditor.images.remove|1" }));
    await waitFor(() => expect(deletePageMediaAction).toHaveBeenCalledWith(g[0].id));
  });
});
