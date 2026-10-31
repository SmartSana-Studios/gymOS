/**
 * Downscales a raster image in the browser before upload so a phone photo (several MB) does not cross a slow link.
 * Returns the original file when it is already small, not a resizable raster, or the browser cannot decode it;
 * resizing is an optimisation, never a reason to refuse the upload.
 */
const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function resizeImageForUpload(
  file: File,
  { maxSide = 512, skipBelowBytes = 150 * 1024 }: { maxSide?: number; skipBelowBytes?: number } = {},
): Promise<File> {
  if (!RESIZABLE.has(file.type) || file.size <= skipBelowBytes) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  }
}
