import sharp, { type Metadata } from "sharp";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import {
  PAGE_MEDIA_ATTESTATION_VERSION,
  PAGE_MEDIA_DERIVATIVE_SIDE,
  PAGE_MEDIA_MAX_BYTES,
  PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE,
  pageMediaKindSchema,
  type AppError,
  type PageMediaErrorCode,
  type PageMediaKind,
} from "@gymos/types";

// Story 24.6 (FR-205, AD-47). Images for a gym's future public page.
//
//   original   -> private bucket gym-page-media-src, key {gym_id}/{uuid}, bytes exactly as uploaded
//   derivative -> public bucket gym-page-media,      key {random uuid}.webp, re-encoded, no gym_id anywhere in the key
//
// Order matters and is the point of this file:
//   1. register_page_media(dry run) -- the database admits the caller (Owner, Supervisor, live-assigned support, super admin),
//      checks the attestation and the limits. Nothing is read from the file and nothing is stored before this passes.
//   2. decode with sharp and judge the CONTENT (magic bytes), never the client's mime type or file name.
//   3. write both objects with the service-role client (the only writer either bucket has).
//   4. register_page_media(for real). If it fails, both objects are removed again.
// Deleting is the RPC only (deleted_at); removing objects is the 24.11 purge.

export const SRC_BUCKET = "gym-page-media-src";
export const DERIVATIVE_BUCKET = "gym-page-media";
const DERIVATIVE_CACHE_SECONDS = "300"; // storage-js turns this into `Cache-Control: max-age=300`
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);
const SOURCE_CONTENT_TYPE: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class PageMediaError extends Error {
  constructor(public readonly code: PageMediaErrorCode | "no_logo" | "upload_failed") {
    super(code);
  }
}

export interface ProcessedImage {
  /** Re-encoded WebP: orientation applied, every metadata block (EXIF, XMP, IPTC, ICC, comments) dropped. */
  derivative: Buffer;
  /** Detected from the decoded bytes. */
  format: "jpeg" | "png" | "webp";
}

/** Validate by decoded content and re-encode. Pure: no network, no database. Throws PageMediaError. */
export async function processPageImage(input: Buffer, kind: PageMediaKind): Promise<ProcessedImage> {
  if (input.length === 0) throw new PageMediaError("unsupported_type");
  if (input.length > PAGE_MEDIA_MAX_BYTES) throw new PageMediaError("too_large");

  let meta: Metadata;
  try {
    // limitInputPixels guards the decoder against a small file that declares a huge canvas.
    meta = await sharp(input, { limitInputPixels: PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE * PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE, failOn: "error" }).metadata();
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) throw new PageMediaError("too_many_pixels");
    throw new PageMediaError("unsupported_type");
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) throw new PageMediaError("unsupported_type");
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) throw new PageMediaError("unsupported_type");
  if (Math.max(width, height) > PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE) throw new PageMediaError("too_many_pixels");

  const side = PAGE_MEDIA_DERIVATIVE_SIDE[kind];
  try {
    const derivative = await sharp(input, { limitInputPixels: PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE * PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE, failOn: "error" })
      .rotate() // applies the EXIF orientation, then drops the tag
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }) // no withMetadata(): sharp writes none of the input's metadata
      .toBuffer();
    return { derivative, format: meta.format as ProcessedImage["format"] };
  } catch {
    throw new PageMediaError("unsupported_type");
  }
}

/** Map a database error from register_page_media / delete_page_media to a typed code, or null when it is not one of ours. */
export function pageMediaCodeFromDbError(error: { message?: string } | null | undefined): PageMediaErrorCode | null {
  const message = error?.message ?? "";
  if (message.includes("attestation_required")) return "attestation_required";
  if (message.includes("limit_reached")) return "limit_reached";
  if (message === "permission denied" || message.includes("permission denied") || message.includes("is not active")) return "not_admitted";
  return null;
}

async function toAppError(e: unknown): Promise<AppError> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (e instanceof PageMediaError) {
    const key = e.code === "upload_failed" ? "uploadFailed" : e.code === "no_logo" ? "noLogo" : e.code;
    return { code: e.code, message: t(`pageMedia.errors.${key}`) };
  }
  console.error("[page-media] unexpected failure", e);
  return { code: "upload_failed", message: t("pageMedia.errors.uploadFailed") };
}

type UserClient = Awaited<ReturnType<typeof createClient>>;

async function callRegister(
  supabase: UserClient,
  args: { gymId: string; kind: PageMediaKind; originalKey: string; derivativeKey: string; dryRun: boolean },
  attested: boolean,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("register_page_media", {
    p_gym_id: args.gymId,
    p_kind: args.kind,
    p_original_key: args.originalKey,
    p_derivative_key: args.derivativeKey,
    p_attested: attested,
    p_attestation_version: PAGE_MEDIA_ATTESTATION_VERSION,
    p_dry_run: args.dryRun,
  });
  if (error) {
    const code = pageMediaCodeFromDbError(error);
    if (code) throw new PageMediaError(code);
    console.error("[page-media] register_page_media failed", error);
    throw new PageMediaError("upload_failed");
  }
  return (data as string | null) ?? null;
}

async function removeObjects(admin: ReturnType<typeof createAdminClient>, originalKey: string, derivativeKey: string) {
  // Independent attempts: a throw while removing the original must not leave the public derivative behind.
  const results = await Promise.allSettled([
    admin.storage.from(DERIVATIVE_BUCKET).remove([derivativeKey]),
    admin.storage.from(SRC_BUCKET).remove([originalKey]),
  ]);
  const failures = results.map((r) => (r.status === "rejected" ? r.reason : r.value.error)).filter(Boolean);
  if (failures.length > 0) {
    console.error(`[page-media] rollback removal failed; orphan objects may remain: ${originalKey} / ${derivativeKey}`, ...failures);
  }
}

/** Steps 3 and 4: store both objects, register the row, undo the objects when registering fails. */
async function storeAndRegister(
  supabase: UserClient,
  gymId: string,
  kind: PageMediaKind,
  original: Buffer,
  processed: ProcessedImage,
): Promise<{ id: string; derivativeKey: string }> {
  const admin = createAdminClient();
  const originalKey = `${gymId}/${randomUUID()}`;
  const derivativeKey = `${randomUUID()}.webp`;

  const up1 = await admin.storage.from(SRC_BUCKET).upload(originalKey, original, {
    contentType: SOURCE_CONTENT_TYPE[processed.format],
    upsert: false,
  });
  if (up1.error) {
    console.error("[page-media] original upload failed", up1.error);
    throw new PageMediaError("upload_failed");
  }
  const up2 = await admin.storage.from(DERIVATIVE_BUCKET).upload(derivativeKey, processed.derivative, {
    contentType: "image/webp",
    cacheControl: DERIVATIVE_CACHE_SECONDS,
    upsert: false,
  });
  if (up2.error) {
    console.error("[page-media] derivative upload failed", up2.error);
    await removeObjects(admin, originalKey, derivativeKey);
    throw new PageMediaError("upload_failed");
  }

  try {
    const id = await callRegister(supabase, { gymId, kind, originalKey, derivativeKey, dryRun: false }, true);
    if (!id) throw new PageMediaError("upload_failed");
    return { id, derivativeKey };
  } catch (e) {
    await removeObjects(admin, originalKey, derivativeKey);
    throw e;
  }
}

/** Admission and limits, with no storage write and no file read. */
async function admit(supabase: UserClient, gymId: string, kind: PageMediaKind, attested: boolean) {
  // The keys are placeholders: a dry run validates their shape but stores nothing.
  await callRegister(
    supabase,
    { gymId, kind, originalKey: `${gymId}/${randomUUID()}`, derivativeKey: `${randomUUID()}.webp`, dryRun: true },
    attested,
  );
}

export interface UploadPageMediaInput {
  gymId: string;
  kind: unknown;
  attested: unknown;
  file: File | Blob | null;
}

export async function uploadPageMedia(
  input: UploadPageMediaInput,
): Promise<{ data: { id: string; derivativeKey: string } | null; error: AppError | null }> {
  try {
    if (!UUID_RE.test(input.gymId)) throw new PageMediaError("not_admitted");
    const kind = pageMediaKindSchema.safeParse(input.kind);
    if (!kind.success) throw new PageMediaError("unsupported_type");
    // Absent or false is refused: only a real boolean true passes.
    const attested = input.attested === true;
    if (!attested) throw new PageMediaError("attestation_required");
    if (!input.file) throw new PageMediaError("unsupported_type");
    // Cheap checks on the declared size before anything else; the real byte length is checked again after reading.
    if (input.file.size > PAGE_MEDIA_MAX_BYTES) throw new PageMediaError("too_large");

    const supabase = await createClient();
    await admit(supabase, input.gymId, kind.data, attested);

    const original = Buffer.from(await input.file.arrayBuffer());
    const processed = await processPageImage(original, kind.data);
    return { data: await storeAndRegister(supabase, input.gymId, kind.data, original, processed), error: null };
  } catch (e) {
    return { data: null, error: await toAppError(e) };
  }
}

/** Pull the object path out of a public gym-logos URL, or null when it is not one of ours. */
export function gymLogoObjectPath(logoUrl: string | null | undefined, gymId: string): string | null {
  if (!logoUrl) return null;
  const marker = "/storage/v1/object/public/gym-logos/";
  const at = logoUrl.indexOf(marker);
  if (at === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(logoUrl.slice(at + marker.length).split(/[?#]/)[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  // The object must sit in this gym's own folder.
  return path.startsWith(`${gymId}/`) && !path.includes("..") ? path : null;
}

/** Re-encode the gym's existing logo (gym-logos) into the page media bucket as kind `logo`. Never links or copies it raw. */
export async function preparePageLogo(
  gymId: string,
  attested: unknown,
): Promise<{ data: { id: string; derivativeKey: string } | null; error: AppError | null }> {
  try {
    if (!UUID_RE.test(gymId)) throw new PageMediaError("not_admitted");
    if (attested !== true) throw new PageMediaError("attestation_required");
    const supabase = await createClient();
    await admit(supabase, gymId, "logo", true);

    // Admitted. The service-role client reads the logo URL and the object (support callers cannot read gyms directly).
    const admin = createAdminClient();
    const { data: gym, error: gymError } = await admin.from("gyms").select("logo_url").eq("id", gymId).maybeSingle();
    if (gymError) {
      console.error("[page-media] reading logo_url failed", gymError);
      throw new PageMediaError("upload_failed");
    }
    const path = gymLogoObjectPath(gym?.logo_url, gymId);
    if (!path) throw new PageMediaError("no_logo");

    const { data: blob, error: downloadError } = await admin.storage.from("gym-logos").download(path);
    if (downloadError || !blob) throw new PageMediaError("no_logo");

    const original = Buffer.from(await blob.arrayBuffer());
    const processed = await processPageImage(original, "logo");
    return { data: await storeAndRegister(supabase, gymId, "logo", original, processed), error: null };
  } catch (e) {
    return { data: null, error: await toAppError(e) };
  }
}

/** Marks the row deleted (the RPC sets deleted_at; the view stops exposing it at once). Object removal is 24.11. */
export async function deletePageMedia(mediaId: string): Promise<{ error: AppError | null }> {
  try {
    if (!UUID_RE.test(mediaId)) throw new PageMediaError("not_admitted");
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_page_media", { p_media_id: mediaId });
    if (error) {
      const code = pageMediaCodeFromDbError(error);
      if (code) throw new PageMediaError(code);
      console.error("[page-media] delete_page_media failed", error);
      throw new PageMediaError("upload_failed");
    }
    return { error: null };
  } catch (e) {
    return { error: await toAppError(e) };
  }
}
