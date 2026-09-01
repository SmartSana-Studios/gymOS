import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi } from "./helpers/auth";
import { supabaseAnonKey, supabaseUrl } from "./helpers/env";

// Story 13.5 Task 5 -- Flow 2: the payment cutover path (Story 4.12,
// AC #1/#2). `payment_providers.taramoney.is_active` already seeds `true`
// (0029, confirmed empirically against a freshly reset local DB via
// Subtask 1.3), so no explicit cutover step is needed in the fixture.
//
// **Real-credentials gate, documented in docs/decisions.md's Story 13.5
// entry (Subtask 5.3):** TaraMoneyProvider.initiate() makes a genuine,
// unconditional HTTPS call to TaraMoney's real, hardcoded production
// endpoint (`MOBILEPAY_URL`, no sandbox/mock seam exists in this codebase)
// with the fixture gym's own *connected* credentials
// (`get_gym_payment_credentials_for_service`) -- fake/throwaway credentials
// would make that real call fail for real, and every failure branch in
// `payment-webhook/index.ts` deletes the `processing` payments row,
// leaving nothing for Subtask 5.2 to complete. A genuinely working,
// gym-connectable Tara Money account is a real, live external dependency
// this repo cannot commit credentials for and CI's default environment
// does not have -- exactly the class of blocker Subtask 5.3 says to
// document rather than silently weaken. This spec is real, complete code;
// it only *runs* when `E2E_TARAMONEY_GYM_API_KEY`/`_BUSINESS_ID`/
// `_WEBHOOK_SECRET` are supplied out-of-band (never committed), matching
// every other payment story's own precedent of a live, credentialed
// verification session rather than an unattended default CI run.
test.skip(
  !loadFixtures().taraMoneyGymCredentialsConnected,
  "Flow 2 requires a real, gym-connectable TaraMoney sandbox account " +
    "(E2E_TARAMONEY_GYM_API_KEY/_BUSINESS_ID/_WEBHOOK_SECRET) -- not present " +
    "by default, including in CI. See docs/decisions.md's Story 13.5 entry.",
);

test.describe("Flow 2: payment cutover path", () => {
  test("a real Tara Money initiate + signed webhook replay completes and verifies the payment", async ({ page, request }) => {
    const fixtures = loadFixtures();

    // Subtask 5.1: as Owner, trigger the real "Send Payment Request"
    // (RenewalModal's mobile_money branch, Story 4.7/4.12's real UI).
    await loginViaUi(page, fixtures.owner.email);
    await page.goto(`/subscriptions`);
    // The fixture Member's subscription is seeded "expiring_soon" --
    // SubscriptionsPageClient's own Renew button only renders for a
    // non-"active" row.
    await page.getByRole("row", { name: new RegExp(fixtures.member.name) }).getByRole("button", { name: "Renew" }).click();
    await page.getByLabel("Payment method").selectOption("mobile_money");
    await page.getByLabel("Payer's phone number").fill(fixtures.member.phone);
    await page.getByRole("button", { name: "Send Payment Request" }).click();

    // Assert (service-role query, not just a UI toast) a new payments row
    // reached processing with a real provider_transaction_ref -- proof the
    // real initiate() round-trip to TaraMoney succeeded.
    const ownerSession = await signInForApi(request, { email: fixtures.owner.email });
    let paymentId: string | undefined;
    let providerRef: string | null | undefined;
    await expect(async () => {
      const response = await request.get(
        `${supabaseUrl()}/rest/v1/payments?gym_id=eq.${fixtures.gymId}&member_id=eq.${fixtures.member.memberId}&status=eq.processing&order=created_at.desc&limit=1`,
        { headers: { apikey: supabaseAnonKey(), Authorization: `Bearer ${ownerSession.accessToken}` } },
      );
      const [row] = (await response.json()) as { id: string; provider_transaction_ref: string | null }[];
      expect(row?.provider_transaction_ref).toBeTruthy();
      paymentId = row.id;
      providerRef = row.provider_transaction_ref;
    }).toPass({ timeout: 30_000 });

    // Subtask 5.2: complete the payment by replaying a signed webhook
    // payload against the real payment-webhook Edge Function -- the same
    // shared-secret-header mechanism (not HMAC-of-body) TaraMoneyProvider's
    // own verifyWebhookSignature() documents, mirroring the
    // fixture-payload-plus-real-secret methodology docs/decisions.md
    // records for every prior payment story's manual spike.
    const webhookResponse = await request.post(`${supabaseUrl()}/functions/v1/payment-webhook/taramoney`, {
      headers: {
        "content-type": "application/json",
        "tara-webhook-secret": process.env.E2E_TARAMONEY_GYM_WEBHOOK_SECRET!,
      },
      data: {
        businessId: process.env.E2E_TARAMONEY_GYM_BUSINESS_ID,
        paymentId: providerRef,
        amount: "15000",
        originalAmount: "14550",
        mobileOperator: "ORANGE_CAMEROON",
        collectionId: providerRef,
        phoneNumber: fixtures.member.phone.replace(/^\+/, ""),
        creationDate: new Date().toISOString(),
        changeDate: new Date().toISOString(),
        status: "SUCCESS",
        productId: paymentId,
        transactionId: providerRef,
      },
    });
    expect(webhookResponse.ok()).toBe(true);

    // Replay idempotency (matches every prior spike's own 3-call pattern):
    // the same payload a second time must not duplicate the row.
    const replayResponse = await request.post(`${supabaseUrl()}/functions/v1/payment-webhook/taramoney`, {
      headers: { "content-type": "application/json", "tara-webhook-secret": process.env.E2E_TARAMONEY_GYM_WEBHOOK_SECRET! },
      data: {
        businessId: process.env.E2E_TARAMONEY_GYM_BUSINESS_ID,
        paymentId: providerRef,
        amount: "15000",
        originalAmount: "14550",
        mobileOperator: "ORANGE_CAMEROON",
        collectionId: providerRef,
        phoneNumber: fixtures.member.phone.replace(/^\+/, ""),
        creationDate: new Date().toISOString(),
        changeDate: new Date().toISOString(),
        status: "SUCCESS",
        productId: paymentId,
        transactionId: providerRef,
      },
    });
    expect(replayResponse.ok()).toBe(true);

    const finalResponse = await request.get(`${supabaseUrl()}/rest/v1/payments?id=eq.${paymentId}&select=status`, {
      headers: { apikey: supabaseAnonKey(), Authorization: `Bearer ${ownerSession.accessToken}` },
    });
    const [finalRow] = (await finalResponse.json()) as { status: string }[];
    expect(finalRow.status).toBe("verified");
  });
});
