// The URL a payment provider calls back when a payment settles.
//
// Normally this is the function's own receive route, rebuilt from the request:
// hosted Supabase preserves the public host and https, so `url.origin` plus the
// path segments up to "initiate/<provider>" is correct.
//
// Local development is different: the request reaches the function through
// Kong (and a tunnel), so the function sees an internal host and http, and the
// /functions/v1 prefix is already stripped. Providers reject that
// (Tara: ONLY_HTTPS_LINKS_ALLOWED). PAYMENT_WEBHOOK_PUBLIC_BASE_URL, set only by
// the local runner, pins the public base (e.g.
// https://<tunnel>/functions/v1/payment-webhook). Unset in every deployed
// environment, so production behaviour is unchanged.
export function buildCallbackUrl(
  url: URL,
  pathSegments: string[],
  providerKey: string,
  publicBaseUrl: string | undefined = Deno.env.get("PAYMENT_WEBHOOK_PUBLIC_BASE_URL"),
): string {
  const base = publicBaseUrl?.trim().replace(/\/+$/, "");
  if (base) {
    return `${base}/${providerKey}`;
  }
  const basePathSegments = pathSegments.slice(0, pathSegments.length - 2);
  return `${url.origin}/${[...basePathSegments, providerKey].join("/")}`;
}
