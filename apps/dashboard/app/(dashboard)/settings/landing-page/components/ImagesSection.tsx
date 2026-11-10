"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ImageIcon, Trash2 } from "lucide-react";
import { PAGE_MEDIA_MAX_BYTES, PAGE_MEDIA_MAX_GALLERY, type PageMediaKind, type PageMediaStatusRow } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import { SectionHeader } from "../../SectionHeader";
import { deletePageMediaAction, preparePageLogoAction, uploadPageMediaAction } from "../../page-media-actions";
import { pageMediaUrl } from "./pageCopy";

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Logo (from Branding), banner and gallery. One attestation checkbox enables every upload. */
export function ImagesSection({
  gymId,
  media,
  onChanged,
  onToast,
}: {
  gymId: string;
  media: PageMediaStatusRow[];
  onChanged: () => Promise<void> | void;
  onToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; noLogo?: boolean } | null>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const logo = media.find((m) => m.kind === "logo");
  const banner = media.find((m) => m.kind === "banner");
  const gallery = media.filter((m) => m.kind === "gallery");
  const galleryFull = gallery.length >= PAGE_MEDIA_MAX_GALLERY;

  async function run(key: string, work: () => Promise<{ error: { code: string; message: string } | null }>, done: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const { error: err } = await work();
      if (err) {
        setError({ message: err.message, noLogo: err.code === "no_logo" });
        return;
      }
      await onChanged();
      onToast(done);
    } catch {
      setError({ message: t("pageMedia.errors.uploadFailed") });
    } finally {
      setBusy(null);
    }
  }

  function upload(kind: PageMediaKind, input: HTMLInputElement | null) {
    const file = input?.files?.[0];
    if (!file) return;
    if (file.size > PAGE_MEDIA_MAX_BYTES) {
      setError({ message: t("pageMedia.errors.too_large") });
      if (input) input.value = "";
      return;
    }
    const form = new FormData();
    form.set("gymId", gymId);
    form.set("kind", kind);
    form.set("attested", "true");
    form.set("file", file);
    void run(`upload-${kind}`, () => uploadPageMediaAction(form), t("pageEditor.images.uploaded")).finally(() => {
      if (input) input.value = "";
    });
  }

  function thumb(row: PageMediaStatusRow, label: string) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={pageMediaUrl(row.derivative_key)} alt={label} className="h-20 w-auto max-w-full rounded border object-cover" />
    );
  }

  return (
    <Card id={PAGE_SECTION_IDS.images} data-testid="section-images">
      <SectionHeader icon={ImageIcon} accent="amber" title={t("pageEditor.sections.images")} description={t("pageEditor.sections.imagesDescription", { max: PAGE_MEDIA_MAX_GALLERY })} />
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2">
          <Checkbox id="pageImageAttest" checked={attested} onCheckedChange={(v) => setAttested(v === true)} />
          <Label htmlFor="pageImageAttest" className="text-sm leading-snug">
            {t("pageEditor.images.attest")}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">{t("pageEditor.images.helper")}</p>
        {error && (
          <p role="alert" className="text-sm text-red-600" data-testid="images-error">
            {error.message}{" "}
            {error.noLogo && (
              <Link href="/settings" className="underline">
                {t("pageEditor.images.goToBranding")}
              </Link>
            )}
          </p>
        )}

        {/* Two halves from 1280 px: logo and banner on the left, the gallery on the right. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2" data-testid="images-columns">
          <div className="space-y-5" data-testid="images-left">
            <div className="space-y-2" data-testid="images-logo">
              <h3 className="text-sm font-medium">{t("pageEditor.images.logo")}</h3>
              {logo ? thumb(logo, t("pageEditor.images.logo")) : <p className="text-sm text-muted-foreground">{t("pageEditor.images.logoMissing")}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!attested || busy !== null}
                  onClick={() => void run("logo", () => preparePageLogoAction(gymId, attested), t("pageEditor.images.uploaded"))}
                >
                  {logo ? t("pageEditor.images.logoRefresh") : t("pageEditor.images.logoUse")}
                </Button>
                <Link href="/settings" className="text-sm underline">
                  {t("pageEditor.images.goToBranding")}
                </Link>
              </div>
            </div>

            <div className="space-y-2" data-testid="images-banner">
              <h3 className="text-sm font-medium">{t("pageEditor.images.banner")}</h3>
              {banner ? thumb(banner, t("pageEditor.images.banner")) : <p className="text-sm text-muted-foreground">{t("pageEditor.images.bannerMissing")}</p>}
              <input ref={bannerRef} type="file" accept={ACCEPT} className="sr-only" id="pageBannerFile" aria-label={t("pageEditor.images.bannerChoose")} onChange={() => upload("banner", bannerRef.current)} />
              <Button type="button" variant="outline" size="sm" disabled={!attested || busy !== null} onClick={() => bannerRef.current?.click()}>
                {banner ? t("pageEditor.images.bannerReplace") : t("pageEditor.images.bannerAdd")}
              </Button>
            </div>

          </div>

          <div className="space-y-2" data-testid="images-gallery">
            <h3 className="text-sm font-medium">{t("pageEditor.images.gallery", { count: gallery.length, max: PAGE_MEDIA_MAX_GALLERY })}</h3>
            {/* The add button comes first, the images under it (owner, 2026-11-10). Disabled until the attestation box above is ticked. */}
            <input ref={galleryRef} type="file" accept={ACCEPT} className="sr-only" id="pageGalleryFile" aria-label={t("pageEditor.images.galleryChoose")} onChange={() => upload("gallery", galleryRef.current)} />
            {galleryFull && <p className="text-sm text-muted-foreground">{t("pageEditor.images.galleryFull", { max: PAGE_MEDIA_MAX_GALLERY })}</p>}
            <Button type="button" variant="outline" size="sm" disabled={!attested || busy !== null || galleryFull} onClick={() => galleryRef.current?.click()}>
              {t("pageEditor.images.galleryAdd")}
            </Button>
            {gallery.length > 0 && (
              <ul className="flex flex-wrap gap-3">
                {gallery.map((g, i) => (
                  <li key={g.id} className="space-y-1">
                    {thumb(g, t("pageEditor.images.galleryItem", { n: i + 1 }))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t("pageEditor.images.remove", { n: i + 1 })}
                      onClick={() => void run(`delete-${g.id}`, () => deletePageMediaAction(g.id), t("pageEditor.images.removed"))}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("pageEditor.images.removeShort")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
