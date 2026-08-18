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

  const { data: paymentRow, error: fetchError } = await supabase
    .from("payments")
    .select("id, status, provider_transaction_ref, amount, currency, gym_id")
    .eq("id", paymentId)
    .maybeSingle();

  if (fetchError) {
    console.error(`payment-webhook: ${providerKey} initiate lookup failed for payment ${paymentId} — ${fetchError.message}`);
    // Nothing was charged yet (this lookup runs before provider.initiate()),
    // so clean up the same way the failed-initiate/failed-signature paths do
    // -- otherwise this leaves an orphaned `processing` row indistinguishable
    // from a real in-flight payment.
    const { error: deleteError } = await supabase.from("payments").delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete payment ${paymentId} after a failed eligibility lookup — ${deleteError.message}`,
      );
    }
    return jsonResponse(500);
  }

  // Guards against calling initiate twice for the same row: not found, not
  // `processing` (already verified/being-processed), or already carries a
  // provider_transaction_ref from a prior initiate call.
  if (!paymentRow || paymentRow.status !== "processing" || paymentRow.provider_transaction_ref !== null) {
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
    const { error: deleteError } = await supabase.from("payments").delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete payment ${paymentId} after the mobile-money-disabled short-circuit — ${deleteError.message}`,
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
      reference: paymentRow.id,
      amount: paymentRow.amount,
      currency: paymentRow.currency,
      callbackUrl,
      phoneNumber,
      // AD-14/Story 4.14: Flow A always routes through the payment's own
      // gym -- payments.gym_id already exists at initiate time, no lookup
      // needed.
      routingContext: { type: "gym", gymId: paymentRow.gym_id },
    });
  } catch (err) {
    // A thrown (not returned) error -- e.g. a non-timeout network failure
    // httpHelpers.ts re-throws rather than converting to a result -- must be
    // treated the same as `result.success === false` below (AC #2): nothing
    // was actually charged, so no orphaned `processing` row is left behind.
    console.error(
      `payment-webhook: ${providerKey} initiate() threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    const { error: deleteError } = await supabase.from("payments").delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete payment ${paymentId} after initiate() threw — ${deleteError.message}`,
      );
    }
    return jsonResponse(502, { error: "payment provider initiation failed" });
  }

  if (!result.success) {
    // AC #2: nothing was actually charged, so no orphaned `processing` row
    // is left behind.
    const { error: deleteError } = await supabase.from("payments").delete().eq("id", paymentId);
    if (deleteError) {
      console.error(
        `payment-webhook: ${providerKey} failed to delete payment ${paymentId} after a failed initiate() — ${deleteError.message}`,
      );
    }
    // The provider's raw error string is logged, not returned -- this route
    // is called server-to-server (dashboard's own service layer), but the
    // caller should still get a generic message rather than a passthrough
    // of provider/internal error text.
    console.error(`payment-webhook: ${providerKey} initiate() failed for payment ${paymentId} — ${result.error}`);

    if (result.code === "credentials_not_connected") {
      // Task 5 (AC #3): a no-op for a gym that was never connected (Story
      // 4.13's ordinary case, already surfaced in Settings) -- the RPC only
      // flips needs_attention when a gym_payment_credentials row actually
      // exists, i.e. a prior connection that is now failing.
      const { error: attentionError } = await supabase.rpc("mark_gym_payment_credentials_needs_attention", {
        p_gym_id: paymentRow.gym_id,
        p_provider_key: providerKey,
      });
      if (attentionError) {
        console.error(
          `payment-webhook: ${providerKey} failed to mark needs_attention for gym ${paymentRow.gym_id} — ${attentionError.message}`,
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
      .from("payments")
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

export default {
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const providerKey = pathSegments[pathSegments.length - 1];
    const isInitiateRoute = pathSegments[pathSegments.length - 2] === "initiate";
    const provider = providerKey ? PROVIDERS[providerKey] : undefined;

    if (!provider) {
      return jsonResponse(404);
    }

    if (isInitiateRoute) {
      return handleInitiate(req, providerKey, provider, url, pathSegments);
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
  },
};
