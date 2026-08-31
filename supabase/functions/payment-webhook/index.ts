import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

import type { InitiatePaymentResult, PaymentProvider } from "./_shared/payment-providers/PaymentProvider.ts";
import { TaraMoneyProvider } from "./_shared/payment-providers/TaraMoneyProvider.ts";

function jsonResponse(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Hoisted to module scope: reused warm isolates run this once per isolate boot.
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

// The one place a future second provider's class gets wired in (AC #4).
// Deliberately independent of payment_providers.is_active -- see the
// dispatch note below for why every *registered* provider's webhook must
// still be honored regardless of which one is currently active. Story 4.14:
// TaraMoneyProvider now takes the same service-role client, needed to
// resolve per-gym credentials (Task 2's new RPCs).
const PROVIDERS: Record<string, PaymentProvider> = {
  taramoney: new TaraMoneyProvider(supabase),
};

/**
 * Story 4.2: POST /payment-webhook/initiate/<providerKey> -- the real
 * orchestration route. Still one Edge Function (architecture.md reserves
 * Edge Functions for "the webhook receiver only" -- extending this
 * function's internal routing is the recorded deviation, not adding a
 * second/third function). Called from apps/dashboard/services/payments.ts's
 * initiatePayment via supabase.functions.invoke, only after the caller's own
 * session already passed the payments INSERT RLS policy (Task 3) -- that
 * INSERT is what proves the caller is authorized; this route trusts a
 * `paymentId` for a row that is real, `processing`, and not yet
 * provider-linked. No JWT verification is added here (verify_jwt = false is
 * required for the public webhook-receive route below, so it applies to
 * this route too) -- see the story's Dev Notes for why that's accepted.
 */
async function handleInitiate(
  req: Request,
  providerKey: string,
  provider: PaymentProvider,
  url: URL,
  pathSegments: string[],
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const { paymentId, phoneNumber } = (body ?? {}) as { paymentId?: string; phoneNumber?: string };
  if (!paymentId || !phoneNumber) {
    return jsonResponse(400, { error: "paymentId and phoneNumber are required" });
  }

  const { data: gymPaymentRow, error: gymFetchError } = await supabase
    .from("payments")
    .select("id, status, provider_transaction_ref, amount, currency, gym_id")
    .eq("id", paymentId)
    .maybeSingle();

  if (gymFetchError) {
    console.error(`payment-webhook: ${providerKey} initiate lookup failed for payment ${paymentId} — ${gymFetchError.message}`);
    // Nothing was charged yet (this lookup runs before provider.initiate()),
    // so clean up the same way the failed-initiate/failed-signature paths do
    // -- otherwise this leaves an orphaned `processing` row indistinguishable
    // from a real in-flight payment. `paymentId` may belong to either table
    // (Story 11.3) and this lookup erroring tells us nothing about which one
    // -- deleting from both is a no-op on whichever table doesn't hold the row.
    const [{ error: deletePaymentsError }, { error: deleteSaasError }] = await Promise.all([
      supabase.from("payments").delete().eq("id", paymentId),
      supabase.from("saas_billing_payments").delete().eq("id", paymentId),
    ]);
    if (deletePaymentsError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete payment ${paymentId} after a failed eligibility lookup — ${deletePaymentsError.message}`,
      );
    }
    if (deleteSaasError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete saas_billing_payments ${paymentId} after a failed eligibility lookup — ${deleteSaasError.message}`,
      );
    }
    return jsonResponse(500);
  }

  // Story 11.3: table-conditional resolution -- `payments` (existing,
  // unchanged code path, the common case) is tried first; on a miss (no
  // error, just no row), fall back to a `saas_billing_payments` lookup by
  // the same globally-unique `paymentId` (Flow B, the platform's own
  // "Pay Now" initiation, `initiate_saas_billing_payment()`). Trying
  // `payments` first is purely "more common case first" -- unlike
  // `verifyWebhookSignature()`'s own platform-first order (a collision-
  // safety requirement specific to a shared `businessId` field), there is
  // no equivalent ordering requirement here since `paymentId` is a
  // globally-unique UUID primary key in only one of the two tables at a
  // time.
  let table: "payments" | "saas_billing_payments" = "payments";
  let payment: { id: string; status: string; provider_transaction_ref: string | null; amount: number; currency: string; gymId: string | null } | null =
    gymPaymentRow
      ? {
          id: gymPaymentRow.id,
          status: gymPaymentRow.status,
          provider_transaction_ref: gymPaymentRow.provider_transaction_ref,
          amount: gymPaymentRow.amount,
          currency: gymPaymentRow.currency,
          gymId: gymPaymentRow.gym_id,
        }
      : null;

  if (!payment) {
    const { data: saasPaymentRow, error: saasFetchError } = await supabase
      .from("saas_billing_payments")
      .select("id, status, provider_transaction_ref, amount, currency")
      .eq("id", paymentId)
      .maybeSingle();

    if (saasFetchError) {
      console.error(
        `payment-webhook: ${providerKey} initiate saas_billing_payments lookup failed for payment ${paymentId} — ${saasFetchError.message}`,
      );
      const { error: deleteError } = await supabase.from("saas_billing_payments").delete().eq("id", paymentId);
      if (deleteError) {
        console.error(
          `payment-webhook: ${providerKey} failed to delete saas_billing_payments ${paymentId} after a failed eligibility lookup — ${deleteError.message}`,
        );
      }
      return jsonResponse(500);
    }

    if (saasPaymentRow) {
      table = "saas_billing_payments";
      payment = {
        id: saasPaymentRow.id,
        status: saasPaymentRow.status,
        provider_transaction_ref: saasPaymentRow.provider_transaction_ref,
        amount: saasPaymentRow.amount,
        currency: saasPaymentRow.currency,
        gymId: null,
      };
    }
  }

  // Guards against calling initiate twice for the same row: not found in
  // either table, not `processing` (already verified/being-processed), or
  // already carries a provider_transaction_ref from a prior initiate call.
  if (!payment || payment.status !== "processing" || payment.provider_transaction_ref !== null) {
    return jsonResponse(400, { error: "payment is not eligible for initiation" });
  }

  // Reconstructs this same function's own receive-route URL regardless of
  // whatever prefix this deployment is served under (e.g.
  // /functions/v1/payment-webhook/initiate/taramoney ->
  // .../functions/v1/payment-webhook/taramoney) -- drops the trailing
  // "initiate/<providerKey>" and re-appends "<providerKey>".
  const basePathSegments = pathSegments.slice(0, pathSegments.length - 2);
  const callbackUrl = `${url.origin}/${[...basePathSegments, providerKey].join("/")}`;

  // Story 4.15 Task 3: the dashboard's own initiatePaymentAction already
  // checks isMobileMoneyInitiationEnabled() (same env var; default-enabled
  // unless explicitly "false", same as that function -- do not invert the
  // default) before ever reaching this route, so this check never changes
  // the dashboard-caller path's behavior in the disabled case. It exists
  // for the new mobile caller (initiate_member_payment() + this same
  // shared route), which has no equivalent dashboard-side pre-check --
  // this is the one point already common to both callers, closing the
  // bypass without a second mobile-reachable source of truth for the flag.
  if (Deno.env.get("TARAMONEY_INITIATION_ENABLED")?.trim().toLowerCase() === "false") {
    // Review finding: every other rejection branch in this function deletes
    // the `processing` row before returning (see the fetch-error and
    // initiate()-throw branches above) -- this short-circuit was the sole
    // exception, leaving a permanently orphaned row a member's next
    // `getPendingMemberPayment()` check would resume into a dead-end.
    const { error: deleteError } = await supabase.from(table).delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete ${table} ${paymentId} after the mobile-money-disabled short-circuit — ${deleteError.message}`,
      );
    }
    return jsonResponse(502, { error: "mobile money initiation is disabled", code: "mobile_money_disabled" });
  }

  let result: InitiatePaymentResult;
  try {
    result = await provider.initiate({
      // A real UUID, globally unique, already exists before the provider call
      // -- replaces the Story 4.1 spike's throwaway
      // <gymId>:<memberId>:<suffix> convention entirely.
      reference: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      callbackUrl,
      phoneNumber,
      // AD-14/Story 4.14: Flow A always routes through the payment's own
      // gym -- payments.gym_id already exists at initiate time, no lookup
      // needed. Story 11.3: Flow B (payment.gymId === null, matched from
      // saas_billing_payments) routes to the platform context instead.
      routingContext: payment.gymId !== null ? { type: "gym", gymId: payment.gymId } : { type: "platform" },
    });
  } catch (err) {
    // A thrown (not returned) error -- e.g. a non-timeout network failure
    // httpHelpers.ts re-throws rather than converting to a result -- must be
    // treated the same as `result.success === false` below (AC #2): nothing
    // was actually charged, so no orphaned `processing` row is left behind.
    console.error(
      `payment-webhook: ${providerKey} initiate() threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    const { error: deleteError } = await supabase.from(table).delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete ${table} ${paymentId} after initiate() threw — ${deleteError.message}`,
      );
    }
    return jsonResponse(502, { error: "payment provider initiation failed" });
  }

  if (!result.success) {
    // AC #2: nothing was actually charged, so no orphaned `processing` row
    // is left behind.
    const { error: deleteError } = await supabase.from(table).delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete ${table} ${paymentId} after a failed initiate() — ${deleteError.message}`,
      );
    }
    // The provider's raw error string is logged, not returned -- this route
    // is called server-to-server (dashboard's own service layer), but the
    // caller should still get a generic message rather than a passthrough
    // of provider/internal error text.
    console.error(`payment-webhook: ${providerKey} initiate() failed for payment ${paymentId} — ${result.error}`);

    if (result.code === "credentials_not_connected" && payment.gymId !== null) {
      // Task 5 (AC #3): a no-op for a gym that was never connected (Story
      // 4.13's ordinary case, already surfaced in Settings) -- the RPC only
      // flips needs_attention when a gym_payment_credentials row actually
      // exists, i.e. a prior connection that is now failing. Story 11.3:
      // this RPC is gym-scoped -- a platform (Flow B) payment's own
      // "credentials_not_connected" (missing TARAMONEY_* env vars) has no
      // gym_payment_credentials row to flag, so this branch is skipped
      // entirely for payment.gymId === null.
      const { error: attentionError } = await supabase.rpc("mark_gym_payment_credentials_needs_attention", {
        p_gym_id: payment.gymId,
        p_provider_key: providerKey,
      });
      if (attentionError) {
        console.error(
          `payment-webhook: ${providerKey} failed to mark needs_attention for gym ${payment.gymId} — ${attentionError.message}`,
        );
      }
      return jsonResponse(502, { error: "payment provider initiation failed", code: "gym_credentials_unavailable" });
    }

    return jsonResponse(502, { error: "payment provider initiation failed" });
  }

  // A successful initiate() means a real charge/USSD prompt was already
  // triggered -- retry the ref-persistence write a few times before giving
  // up, so a transient DB error doesn't strand the row `processing` with a
  // still-null provider_transaction_ref (indistinguishable from "never
  // initiated", which would make it look safe to initiate again).
  let updateError: { message: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase
      .from(table)
      .update({ provider_transaction_ref: result.providerTransactionRef })
      .eq("id", paymentId);
    updateError = error;
    if (!updateError) break;
    console.error(
      `payment-webhook: ${providerKey} attempt ${attempt}/3 to persist provider_transaction_ref for payment ${paymentId} failed — ${updateError.message}`,
    );
  }

  if (updateError) {
    console.error(
      `payment-webhook: ${providerKey} failed to persist provider_transaction_ref for payment ${paymentId} after 3 attempts — ${updateError.message}`,
    );
    return jsonResponse(500);
  }

  return jsonResponse(200, {
    providerTransactionRef: result.providerTransactionRef,
    authorizationUrl: result.authorizationUrl,
  });
}

/**
 * Story 11.7 (AC #3): POST /payment-webhook/initiate-link/<providerKey> --
 * the "Continue on Tara" alternate-method fallback. Mirrors handleInitiate's
 * eligibility checks (row exists, still `processing`, not already
 * provider-linked) but calls `createHostedCheckoutLink()` instead of
 * `initiate()`, needs no `phoneNumber` (the hosted page collects payment
 * details itself), and does not persist a `provider_transaction_ref` --
 * unlike the direct mobile-money flow, a payment link's response carries no
 * transaction reference up front (only checkout links); the real reference
 * is first learned when the webhook itself arrives.
 *
 * Only ever reached for Flow B (`saas_billing_payments`, gymId === null) in
 * practice -- this story's own scope (AD-14: never Flow A) -- but table
 * resolution mirrors handleInitiate's own payments-then-saas_billing_payments
 * fallback for symmetry/consistency rather than hardcoding one table.
 */
async function handleInitiateLink(
  req: Request,
  providerKey: string,
  provider: PaymentProvider,
  url: URL,
  pathSegments: string[],
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(405);
  }

  if (!provider.createHostedCheckoutLink) {
    return jsonResponse(400, { error: `${providerKey} does not support hosted checkout links` });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const { paymentId } = (body ?? {}) as { paymentId?: string };
  if (!paymentId) {
    return jsonResponse(400, { error: "paymentId is required" });
  }

  const { data: gymPaymentRow, error: gymFetchError } = await supabase
    .from("payments")
    .select("id, status, provider_transaction_ref, amount, currency, gym_id")
    .eq("id", paymentId)
    .maybeSingle();

  if (gymFetchError) {
    console.error(`payment-webhook: ${providerKey} initiate-link lookup failed for payment ${paymentId} — ${gymFetchError.message}`);
    return jsonResponse(500);
  }

  let table: "payments" | "saas_billing_payments" = "payments";
  let payment: { id: string; status: string; provider_transaction_ref: string | null; amount: number; currency: string; gymId: string | null } | null =
    gymPaymentRow
      ? {
          id: gymPaymentRow.id,
          status: gymPaymentRow.status,
          provider_transaction_ref: gymPaymentRow.provider_transaction_ref,
          amount: gymPaymentRow.amount,
          currency: gymPaymentRow.currency,
          gymId: gymPaymentRow.gym_id,
        }
      : null;

  if (!payment) {
    const { data: saasPaymentRow, error: saasFetchError } = await supabase
      .from("saas_billing_payments")
      .select("id, status, provider_transaction_ref, amount, currency")
      .eq("id", paymentId)
      .maybeSingle();

    if (saasFetchError) {
      console.error(
        `payment-webhook: ${providerKey} initiate-link saas_billing_payments lookup failed for payment ${paymentId} — ${saasFetchError.message}`,
      );
      return jsonResponse(500);
    }

    if (saasPaymentRow) {
      table = "saas_billing_payments";
      payment = {
        id: saasPaymentRow.id,
        status: saasPaymentRow.status,
        provider_transaction_ref: saasPaymentRow.provider_transaction_ref,
        amount: saasPaymentRow.amount,
        currency: saasPaymentRow.currency,
        gymId: null,
      };
    }
  }

  if (!payment || payment.status !== "processing" || payment.provider_transaction_ref !== null) {
    return jsonResponse(400, { error: "payment is not eligible for initiation" });
  }

  // Same reconstruction as handleInitiate's own callbackUrl, dropping
  // "initiate-link/<providerKey>" instead of "initiate/<providerKey>".
  const basePathSegments = pathSegments.slice(0, pathSegments.length - 2);
  const callbackUrl = `${url.origin}/${[...basePathSegments, providerKey].join("/")}`;

  const result = await provider.createHostedCheckoutLink({
    reference: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    productName: "GymOS subscription",
    callbackUrl,
    routingContext: payment.gymId !== null ? { type: "gym", gymId: payment.gymId } : { type: "platform" },
  });

  if (!result.success) {
    console.error(`payment-webhook: ${providerKey} createHostedCheckoutLink() failed for payment ${paymentId} — ${result.error}`);
    return jsonResponse(502, { error: "payment provider link creation failed" });
  }

  return jsonResponse(200, { checkoutUrl: result.checkoutUrl });
}

export default {
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const providerKey = pathSegments[pathSegments.length - 1];
    const isInitiateRoute = pathSegments[pathSegments.length - 2] === "initiate";
    const isInitiateLinkRoute = pathSegments[pathSegments.length - 2] === "initiate-link";
    const provider = providerKey ? PROVIDERS[providerKey] : undefined;

    if (!provider) {
      return jsonResponse(404);
    }

    if (isInitiateRoute) {
      return handleInitiate(req, providerKey, provider, url, pathSegments);
    }

    if (isInitiateLinkRoute) {
      return handleInitiateLink(req, providerKey, provider, url, pathSegments);
    }

    const payloadText = await req.text();
    const headers = Object.fromEntries(req.headers);

    // Verified unconditionally against whichever provider the URL path
    // names -- is_active only controls which provider initiate() targets
    // for *new* payments, not which already-issued webhooks are honored. A
    // payment initiated while provider X was active must still be able to
    // complete via its webhook even if a Super Admin flips the active
    // provider to Y in the meantime.
    let verification;
    try {
      verification = await provider.verifyWebhookSignature(payloadText, headers);
    } catch (err) {
      console.error(
        `payment-webhook: ${providerKey} signature verification threw — ${err instanceof Error ? err.message : String(err)}`,
      );
      return jsonResponse(401);
    }

    if (!verification.valid || !verification.event) {
      console.error(`payment-webhook: ${providerKey} webhook failed signature verification`);
      return jsonResponse(401);
    }

    const event = verification.event;

    // Story 11.1/AD-14: dispatch on which account verifyWebhookSignature()
    // resolved this delivery against -- Flow A (gym) against `payments`
    // (unchanged from before this story), Flow B (platform) against the new
    // `saas_billing_payments`. One shared Edge Function, one shared
    // `payment_webhook_events` idempotency log for both (AC #3) -- only the
    // target table/columns/RPCs differ between the two branches below.
    if (event.resolvedRoutingContext.type === "gym") {
      // AC #3(a)/Story 4.4 Task 2: matched to the pre-existing payments row by
      // provider_transaction_ref (set at initiate time) -- no new row is ever
      // inserted by the webhook handler. Moved ahead of the
      // `event.status !== "verified"` branch (below) so a declined delivery's
      // matched_payment_id is available to the payment_webhook_events insert
      // too -- previously a declined delivery never even attempted this
      // lookup.
      const { data: paymentRow, error: lookupError } = await supabase
        .from("payments")
        .select("id, gym_id")
        .eq("provider_transaction_ref", event.providerTransactionRef)
        .maybeSingle();

      if (lookupError) {
        console.error(`payment-webhook: ${providerKey} payments lookup failed — ${lookupError.message}`);
        return jsonResponse(500);
      }

      // Story 4.4 Task 2: persist one payment_webhook_events row per
      // signature-verified delivery, matched or not -- the reconciliation
      // job's only source of truth for AC #1 (an event with no matching
      // payments row). `ignoreDuplicates` relies on the table's own
      // (provider_key, provider_transaction_ref) unique index to make a
      // retried delivery a no-op rather than a second log row. A failure here
      // is logged but never blocks the completion path below -- reconciliation
      // -log durability is a nice-to-have, real payment completion is not.
      const { error: eventLogError } = await supabase
        .from("payment_webhook_events")
        .upsert(
          {
            provider_key: providerKey,
            provider_transaction_ref: event.providerTransactionRef,
            reference: event.reference ?? null,
            amount: event.amount,
            currency: event.currency,
            status: event.status,
            matched_payment_id: paymentRow?.id ?? null,
            raw_payload: JSON.parse(payloadText),
          },
          { onConflict: "provider_key,provider_transaction_ref", ignoreDuplicates: true },
        );

      if (eventLogError) {
        console.error(
          `payment-webhook: ${providerKey} failed to persist payment_webhook_events row for ${event.providerTransactionRef} — ${eventLogError.message}`,
        );
      }

      if (event.status !== "verified") {
        // Story 6.3: a declined/failed delivery now has a real, observable
        // completion path. complete_flagged_payment() only transitions a row
        // that is still `processing` (idempotency guard for a retried
        // delivery) -- the payments AFTER INSERT OR UPDATE trigger (migration
        // 0046) fires N-05 on exactly that processing -> flagged transition,
        // distinct from a staff "Flag for Review" (pending -> flagged), which
        // stays silent. When no matching payments row was found, there is
        // nothing to transition -- Story 4.4's reconciliation job remains the
        // catch-all for that case.
        console.error(
          `payment-webhook: ${providerKey} webhook for ${event.providerTransactionRef} reported status "${event.status}"`,
        );

        if (paymentRow) {
          console.error(
            `payment-webhook: ${providerKey} flagging payment ${paymentRow.id} for ${event.providerTransactionRef}`,
          );

          const { error: flagError } = await supabase.rpc("complete_flagged_payment", {
            p_payment_id: paymentRow.id,
          });

          if (flagError) {
            console.error(
              `payment-webhook: ${providerKey} complete_flagged_payment failed for payment ${paymentRow.id} — ${flagError.message}`,
            );
            return jsonResponse(500);
          }
        }

        return jsonResponse(200);
      }

      if (!paymentRow) {
        // AC #3(b): defensive -- should not occur in normal operation, since
        // initiate always sets provider_transaction_ref before any webhook
        // for it can arrive.
        console.error(
          `payment-webhook: ${providerKey} webhook for ${event.providerTransactionRef} matched no payments row -- nothing to do`,
        );
        return jsonResponse(200);
      }

      // Review finding: verifyWebhookSignature resolves gym_id from the
      // payload's businessId internally, but the payments-row match above is
      // purely by provider_transaction_ref -- a synchronous cross-check
      // closes the gap where a signature-verified delivery for gym A's
      // account could otherwise complete a payment row that actually belongs
      // to a different gym (a provider_transaction_ref collision/anomaly).
      // Previously this was only ever caught after the fact, and only for
      // gyms already connected, by run_payment_reconciliation_job()'s
      // wrong_account_settlement category -- this prevents it synchronously
      // instead of merely detecting it later.
      if (event.resolvedGymId && event.resolvedGymId !== paymentRow.gym_id) {
        console.error(
          `payment-webhook: ${providerKey} webhook for ${event.providerTransactionRef} resolved to gym ${event.resolvedGymId} but matched payment ${paymentRow.id} belongs to gym ${paymentRow.gym_id} -- refusing to complete, leaving for reconciliation`,
        );
        return jsonResponse(200);
      }

      // AC #6: fee capture, when derivable (TaraMoney's originalAmount vs.
      // amount delta). null when the provider's payload didn't carry enough
      // to compute it -- complete_verified_payment stores whatever is passed.
      const feeAmount = event.feeAmount ?? null;

      const { error: completeError } = await supabase.rpc("complete_verified_payment", {
        p_payment_id: paymentRow.id,
        p_fee_amount: feeAmount,
      });

      if (completeError) {
        console.error(
          `payment-webhook: ${providerKey} complete_verified_payment failed for payment ${paymentRow.id} — ${completeError.message}`,
        );
        return jsonResponse(500);
      }

      return jsonResponse(200);
    }

    // event.resolvedRoutingContext.type === "platform" (Story 11.1, Flow B):
    // mirrors the gym branch above 1:1 against saas_billing_payments -- same
    // shape, same one shared payment_webhook_events log (writing
    // matched_saas_billing_payment_id instead of matched_payment_id), same
    // completion-RPC idempotency contract. No gym_id exists on a matched
    // saas_billing_payments row, so the gym branch's cross-tenant cross-check
    // does not apply here -- there is no cross-tenant case to guard against
    // (Task 3's own scope note).
    let { data: saasPaymentRow, error: saasLookupError } = await supabase
      .from("saas_billing_payments")
      .select("id")
      .eq("provider_transaction_ref", event.providerTransactionRef)
      .maybeSingle();

    if (saasLookupError) {
      console.error(`payment-webhook: ${providerKey} saas_billing_payments lookup failed — ${saasLookupError.message}`);
      return jsonResponse(500);
    }

    // Story 11.7 (AC #3): a payment-link-initiated row
    // (handleInitiateLink()) never learns a provider_transaction_ref up
    // front -- createHostedCheckoutLink()'s response carries only checkout
    // links, no transaction reference, unlike initiate()'s direct
    // mobile-money flow.
    //
    // CONFIRMED live against the real 9FmIZg9GBB account (2026-08-30, a
    // real WhatsApp-completed payment-link payment): a payment-link
    // webhook's shape is genuinely different from the direct mobilePay()
    // webhook, not just missing a few optional fields. Real captured
    // payload: {"businessId":"9FmIZg9GBB","paymentId":"<our own
    // createHostedCheckoutLink() productId>","collectionId":"<Tara's own
    // numeric order id>","creationDate":"...","changeDate":"...","status":"SUCCESS"}
    // -- no `productId` field at all (so `event.reference`, which reads
    // `rawPayload.productId`, is always undefined for this flow -- an
    // earlier version of this fallback matched on `event.reference` and
    // would never have fired), no `amount`/`phoneNumber`/`mobileOperator`.
    // Critically, this webhook's own `paymentId` field -- which
    // `normalizeTaraMoneyWebhook()` already maps to
    // `event.providerTransactionRef` -- directly echoes back whatever
    // *we* sent as `productId` when creating the link
    // (`createHostedCheckoutLink()` sends `productId: params.reference`,
    // the payment's own `saas_billing_payments.id`). So for this flow
    // specifically, `event.providerTransactionRef` already equals the
    // row's own primary key -- the fallback matches on `id`, not on a
    // separate `reference` field, and it is safe for the direct
    // mobile-money flow too (its own `providerTransactionRef` is a
    // TaraMoney-generated numeric id that can never equal one of our
    // uuids, so this fallback simply never matches anything for it).
    if (!saasPaymentRow) {
      const { data: linkRow, error: linkLookupError } = await supabase
        .from("saas_billing_payments")
        .select("id")
        .eq("id", event.providerTransactionRef)
        .is("provider_transaction_ref", null)
        .maybeSingle();

      if (linkLookupError) {
        console.error(`payment-webhook: ${providerKey} saas_billing_payments link-fallback lookup failed — ${linkLookupError.message}`);
        return jsonResponse(500);
      }

      if (linkRow) {
        const { error: refUpdateError } = await supabase
          .from("saas_billing_payments")
          .update({ provider_transaction_ref: event.providerTransactionRef })
          .eq("id", linkRow.id);

        if (refUpdateError) {
          console.error(
            `payment-webhook: ${providerKey} failed to persist provider_transaction_ref for link-originated payment ${linkRow.id} — ${refUpdateError.message}`,
          );
          return jsonResponse(500);
        }

        saasPaymentRow = linkRow;
      }
    }

    const { error: saasEventLogError } = await supabase
      .from("payment_webhook_events")
      .upsert(
        {
          provider_key: providerKey,
          provider_transaction_ref: event.providerTransactionRef,
          reference: event.reference ?? null,
          amount: event.amount,
          currency: event.currency,
          status: event.status,
          matched_saas_billing_payment_id: saasPaymentRow?.id ?? null,
          raw_payload: JSON.parse(payloadText),
        },
        { onConflict: "provider_key,provider_transaction_ref", ignoreDuplicates: true },
      );

    if (saasEventLogError) {
      console.error(
        `payment-webhook: ${providerKey} failed to persist payment_webhook_events row for ${event.providerTransactionRef} — ${saasEventLogError.message}`,
      );
    }

    if (event.status !== "verified") {
      console.error(
        `payment-webhook: ${providerKey} webhook for ${event.providerTransactionRef} reported status "${event.status}"`,
      );

      if (saasPaymentRow) {
        console.error(
          `payment-webhook: ${providerKey} flagging saas billing payment ${saasPaymentRow.id} for ${event.providerTransactionRef}`,
        );

        const { error: flagError } = await supabase.rpc("complete_flagged_saas_billing_payment", {
          p_payment_id: saasPaymentRow.id,
        });

        if (flagError) {
          console.error(
            `payment-webhook: ${providerKey} complete_flagged_saas_billing_payment failed for payment ${saasPaymentRow.id} — ${flagError.message}`,
          );
          return jsonResponse(500);
        }
      }

      return jsonResponse(200);
    }

    if (!saasPaymentRow) {
      console.error(
        `payment-webhook: ${providerKey} webhook for ${event.providerTransactionRef} matched no saas_billing_payments row -- nothing to do`,
      );
      return jsonResponse(200);
    }

    const feeAmount = event.feeAmount ?? null;

    const { error: completeError } = await supabase.rpc("complete_verified_saas_billing_payment", {
      p_payment_id: saasPaymentRow.id,
      p_fee_amount: feeAmount,
    });

    if (completeError) {
      console.error(
        `payment-webhook: ${providerKey} complete_verified_saas_billing_payment failed for payment ${saasPaymentRow.id} — ${completeError.message}`,
      );
      return jsonResponse(500);
    }

    return jsonResponse(200);
  },
};
