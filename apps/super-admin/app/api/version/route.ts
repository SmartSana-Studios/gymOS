import { BUILD_ID } from "@/lib/build-id";

/** The build the server is running right now. Polled by `UpdateNotice` so a
 * long-open tab can tell the person a newer version is available. Exposes only
 * the deploy's commit SHA. Public on purpose (the proxy exempts it): a stale
 * login page needs the notice too. */
export function GET() {
  return Response.json(
    { version: BUILD_ID },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
