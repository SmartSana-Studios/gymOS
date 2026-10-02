import { permanentRedirect } from "next/navigation";
import { DASHBOARD_URL } from "@/lib/config";

/**
 * `gymosapps.com/privacy` is the URL a visitor will guess, and the one a
 * store reviewer may try after seeing the marketing domain. It is NOT where
 * the policy lives.
 *
 * The policy is served by apps/dashboard at `owner.gymosapps.com/privacy`,
 * which is the URL registered in both store consoles. Redirecting rather
 * than copying the text here is deliberate: a second rendering of a legal
 * document is a second thing to keep in sync, and the failure mode is a
 * store reviewer or a member reading a stale policy. One canonical copy,
 * one place to edit (apps/dashboard/lib/legal/privacy-policy.ts).
 *
 * 308 rather than 302 so the redirect is cacheable and the method is
 * preserved -- this target is not expected to move again.
 */
export function GET() {
  permanentRedirect(`${DASHBOARD_URL}/privacy`);
}
