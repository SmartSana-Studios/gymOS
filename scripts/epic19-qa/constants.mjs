// Shared by the Epic 19 QA scripts. Everything here is LOCAL-only throwaway data.
export const SUPABASE_URL = "http://127.0.0.1:54321";
export const PW = "Epic19Pass!";
export const SESSION_PRICE = 5000;
export const FAKE_TARA_PORT = Number(process.env.FAKE_TARA_PORT ?? 4010);
export const FAKE_TARA_URL = `http://127.0.0.1:${FAKE_TARA_PORT}`;
// The gym's "connected Tara account": the webhook resolves the gym from the businessId and checks the secret.
export const TARA = { apiKey: "ep19-qa-api-key", businessId: "EP19QABIZ", webhookSecret: "ep19-qa-webhook-secret" };
export const OTHER_TARA = { apiKey: "ep19-other-api-key", businessId: "EP19OTHERBIZ", webhookSecret: "ep19-other-webhook-secret" };
export const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/payment-webhook/taramoney`;
// The two phone numbers GoTrue's test_otp map (supabase/config.toml) answers with 123456.
export const PHONE_A = "237699000001";
export const PHONE_B = "237670000001";
