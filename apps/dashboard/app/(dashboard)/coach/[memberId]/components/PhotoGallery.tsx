"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SharedProgressPhoto } from "@/services/coaches";

// MembersPageClient.tsx's/CoachPortalPageClient.tsx's exact local-date-
// parsing pattern -- per-file copy, this app's established convention.
function formatPhotoDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/** Thumbnail grid + click-to-open lightbox with prev/next navigation
 * (arrow buttons, arrow-key/Escape support, wraparound). Every photo passed
 * in is already RLS-guaranteed shared (Story 10.4 Scope Notes) -- no lock
 * icons, no unshared state to render. A `signedUrl: null` entry (signing
 * failed for that one photo, degrade-gracefully per `getMemberProgressData`)
 * renders a muted placeholder tile and is excluded from the lightbox's own
 * navigable set.
 *
 * Kept as a deliberate scope addition beyond the story's original "no
 * click-through view" note (2026-08-22 review decision, docs/decisions.md) --
 * ships with real dialog semantics (`role="dialog"`/`aria-modal`), a focus
 * trap on open, focus restored to the triggering thumbnail on close, and
 * descriptive alt text (a shared progress photo is substantive content, not
 * decorative). */
export function PhotoGallery({ photos }: { photos: SharedProgressPhoto[] }) {
  const { t, i18n } = useTranslation();
  const viewable = photos.filter(
    (photo): photo is SharedProgressPhoto & { signedUrl: string } => photo.signedUrl != null,
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function openLightbox(index: number, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setOpenIndex(index);
  }

  function closeLightbox() {
    setOpenIndex(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (openIndex === null || viewable.length === 0) return;
    closeButtonRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? null : (i - 1 + viewable.length) % viewable.length));
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? null : (i + 1) % viewable.length));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openIndex, viewable.length]);

  if (photos.length === 0) return null;

  const current = openIndex != null ? viewable[openIndex] : null;
  const currentAlt = current
    ? t("coachPortal.detail.progressTab.sharedPhotoAlt", { date: formatPhotoDate(current.createdAt, i18n.language) })
    : "";

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => {
          const viewableIndex = viewable.findIndex((p) => p.id === photo.id);
          return photo.signedUrl ? (
            <button
              key={photo.id}
              type="button"
              onClick={(e) => openLightbox(viewableIndex, e.currentTarget)}
              className="group aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
              <img
                src={photo.signedUrl}
                alt={t("coachPortal.detail.progressTab.sharedPhotoAlt", {
                  date: formatPhotoDate(photo.createdAt, i18n.language),
                })}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-110"
              />
            </button>
          ) : (
            <div key={photo.id} className="aspect-square rounded-lg border bg-muted" />
          );
        })}
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={currentAlt}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={closeLightbox}
        >
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t("coachPortal.detail.progressTab.closePhotoViewer")}
            onClick={closeLightbox}
            className="absolute right-4 top-4 text-white/70 transition-colors hover:text-white"
          >
            <X size={28} />
          </button>

          {viewable.length > 1 && (
            <button
              type="button"
              aria-label={t("coachPortal.detail.progressTab.previousPhoto")}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex((i) => (i === null ? null : (i - 1 + viewable.length) % viewable.length));
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:left-4"
            >
              <ChevronLeft size={36} />
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
          <img
            src={current.signedUrl}
            alt={currentAlt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
          />

          {viewable.length > 1 && (
            <button
              type="button"
              aria-label={t("coachPortal.detail.progressTab.nextPhoto")}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex((i) => (i === null ? null : (i + 1) % viewable.length));
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:right-4"
            >
              <ChevronRight size={36} />
            </button>
          )}

          {viewable.length > 1 && openIndex !== null && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/90">
              {openIndex + 1} / {viewable.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}
