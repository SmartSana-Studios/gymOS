"use server";

import type { AppError } from "@gymos/types";
import { deletePageMedia, preparePageLogo, uploadPageMedia } from "@/services/page-media";

// Story 24.6. Server Actions never trust client input: the service re-judges the file by its decoded bytes and the database
// admits the caller. No editor UI yet (24.9); these are the entry points it will call.

export async function uploadPageMediaAction(
  formData: FormData,
): Promise<{ data: { id: string; derivativeKey: string } | null; error: AppError | null }> {
  const file = formData.get("file");
  const gymId = formData.get("gymId");
  return uploadPageMedia({
    gymId: typeof gymId === "string" ? gymId : "",
    kind: formData.get("kind"),
    attested: formData.get("attested") === "true",
    file: file instanceof Blob ? file : null,
  });
}

export async function preparePageLogoAction(gymId: string, attested: boolean) {
  return preparePageLogo(gymId, attested === true);
}

export async function deletePageMediaAction(mediaId: string) {
  return deletePageMedia(mediaId);
}
