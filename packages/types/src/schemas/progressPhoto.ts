import { z } from "zod";

// Story 10.2: Progress Data & Photo Privacy. Trivial shape, but this
// codebase's Consistency Convention still requires it live here rather than
// inline at the write boundary ("Validation: Zod schemas live once in
// packages/types, consumed by every write boundary... never redefined
// inline").
export const updateProgressPhotoSharingSchema = z.object({
  photoId: z.string().uuid(),
  shared: z.boolean(),
});

export type UpdateProgressPhotoSharingInput = z.infer<typeof updateProgressPhotoSharingSchema>;
