import type { DeliveryResult, OtpDeliveryProvider } from "./OtpDeliveryProvider.ts";
import { errorResult, postJsonWithTimeout } from "./httpHelpers.ts";

// This exact { code, var_2 } shape is coupled to SENT_DM_OTP_TEMPLATE_ID's specific template
// ("ACCOUNT VERIFICATION") and is NOT a generic sent.dm contract — confirmed via a real send +
// GET /v3/templates/{id} during the Story 2.1 spike: this template is a WhatsApp Authentication
// template with a native "Copy Code" button. "code" fills the body's variable; "var_2" fills the
// button's own separate {{1:variable}} slot in its otp-code deep link — both must carry the SAME
// code, or Meta's Graph API rejects the button with ERR_TEMPLATE_PARAMS_INVALID (confirmed failure
// mode, not a guess). If SENT_DM_OTP_TEMPLATE_ID is ever repointed at a different template, this
// parameter shape must be re-verified against that template's own GET /v3/templates/{id} response
// — a mismatch fails with the same opaque VALIDATION_004 error this spike spent real time diagnosing.
function templateParameters(code: string): Record<string, string> {
  return { code, var_2: code };
}

export class SentDmProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string, _locale: "en" | "fr"): Promise<DeliveryResult> {
    const apiKey = Deno.env.get("SENT_DM_API_KEY");
    const templateId = Deno.env.get("SENT_DM_OTP_TEMPLATE_ID");

    if (!apiKey || !templateId) {
      return { success: false, error: "sent.dm credentials are not configured" };
    }

    const result = await postJsonWithTimeout("sent.dm", "https://api.sent.dm/v3/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [phone],
        template: {
          id: templateId,
          parameters: templateParameters(code),
        },
      }),
    });

    if (!(result instanceof Response)) {
      return result;
    }

    if (!result.ok) {
      return errorResult("sent.dm", result);
    }

    try {
      const data = await result.json();
      const channel = data?.data?.recipients?.[0]?.channel;
      return channel ? { success: true, channel } : { success: true };
    } catch {
      // A 2xx with an empty/non-JSON body is a real send that already succeeded — don't fail
      // the whole delivery over an unparseable confirmation body, just drop the optional channel.
      return { success: true };
    }
  }
}
