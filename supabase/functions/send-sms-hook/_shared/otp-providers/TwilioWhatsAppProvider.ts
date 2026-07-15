import type { DeliveryResult, OtpDeliveryProvider } from "./OtpDeliveryProvider.ts";
import { sendTwilioMessage } from "./httpHelpers.ts";

export class TwilioWhatsAppProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string, _locale: "en" | "fr"): Promise<DeliveryResult> {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const whatsappFrom = Deno.env.get("TWILIO_WHATSAPP_FROM_NUMBER");
    const contentSid = Deno.env.get("TWILIO_WHATSAPP_CONTENT_SID");

    if (!accountSid || !authToken || !whatsappFrom || !contentSid) {
      return { success: false, error: "Twilio WhatsApp credentials are not configured" };
    }

    // Twilio's WhatsApp Authentication content template ("verifications_2fa_template") has a single
    // body variable ({{1}}) and a native Copy Code button — Twilio/Meta render the surrounding
    // security-disclaimer text automatically (add_security_recommendation), unlike TwilioSmsProvider's
    // own hardcoded inline body. ContentVariables replaces Body for content-template-based sends.
    const body = new URLSearchParams({
      To: `whatsapp:${phone}`,
      From: `whatsapp:${whatsappFrom}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({ "1": code }),
    });

    const result = await sendTwilioMessage(accountSid, authToken, body, "Twilio WhatsApp");
    return result.success ? { ...result, channel: "whatsapp" } : result;
  }
}
