import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

function jsonResponse(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Hoisted to module scope: reused warm isolates run this once per isolate boot
// (same convention as payment-webhook/index.ts).
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("gym-qr-display: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

// Story 8.2: an unauthenticated device (e-ink display at a gym's front desk)
// polls GET /gym-qr-display/<gymToken> and gets back the current check-in QR
// as a PNG. gym_token is the same value QRCode.toDataURL(gymToken) already
// encodes client-side in apps/dashboard's Settings page -- this endpoint just
// renders it server-side for a device that can't run JS. The token is a
// bearer secret here (service-role bypasses RLS's private.gym_id() session
// scoping, so anyone with a valid token gets the image, no session required)
// -- accepted per docs/decisions.md's 2026-08-05 entry, since anyone who
// already has the physical QR/token has this same level of access.
export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method !== "GET") {
      return jsonResponse(405);
    }

    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const gymToken = pathSegments[pathSegments.length - 1];

    if (!gymToken || pathSegments[pathSegments.length - 2] !== "gym-qr-display") {
      return jsonResponse(404);
    }

    let gym: { id: string } | null;
    try {
      const { data, error } = await supabase
        .from("gyms")
        .select("id")
        .eq("gym_token", gymToken)
        .maybeSingle();

      if (error) {
        console.error(`gym-qr-display: gyms lookup failed — ${error.message}`);
        return jsonResponse(500);
      }
      gym = data;
    } catch (err) {
      console.error(`gym-qr-display: gyms lookup threw — ${err instanceof Error ? err.message : String(err)}`);
      return jsonResponse(500);
    }

    if (!gym) {
      return jsonResponse(404);
    }

    let png: Uint8Array;
    try {
      png = await QRCode.toBuffer(gymToken, { type: "png" });
    } catch (err) {
      console.error(`gym-qr-display: QR render failed — ${err instanceof Error ? err.message : String(err)}`);
      return jsonResponse(500);
    }

    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  },
};
