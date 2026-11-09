// Story 24.11: the body of the report form. A browser posts `application/x-www-form-urlencoded`; anything else, or a body over the cap, is "bad"
// (the handler answers the form again with its failure line). Read with a hard cap so a hostile client cannot make the route buffer a large body.
import { REPORT_MAX_BODY_BYTES } from "@gymos/page-templates";

export type FormBody = { kind: "ok"; params: URLSearchParams } | { kind: "bad" };

export async function readFormBody(request: Request, maxBytes: number = REPORT_MAX_BODY_BYTES): Promise<FormBody> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return { kind: "bad" };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: "bad" };
  if (!request.body) return { kind: "bad" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "bad" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "bad" };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  return { kind: "ok", params: new URLSearchParams(text) };
}

/** The visitor's address as the platform's proxy reports it (Vercel sets both headers and overwrites a client-supplied value). Never stored: it only feeds the keyed hash. */
export function clientAddress(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = real || forwarded;
  return ip ? ip.slice(0, 64) : null;
}
