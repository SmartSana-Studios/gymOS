import type { DeliveryResult, OtpDeliveryProvider } from "./OtpDeliveryProvider.ts";
import { sendTwilioMessage } from "./httpHelpers.ts";

const MESSAGES: Record<"en" | "fr", string> = {
  en: "Your GymOS code is: {code}",
  fr: "Votre code GymOS est : {code}",
};

export class TwilioSmsProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult> {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      return { success: false, error: "Twilio credentials are not configured" };
    }

    const body = new URLSearchParams({
      To: phone,
      Body: MESSAGES[locale].replace("{code}", code),
    });
    if (messagingServiceSid) {
      body.set("MessagingServiceSid", messagingServiceSid);
    } else {
      body.set("From", fromNumber!);
    }

    return sendTwilioMessage(accountSid, authToken, body);
  }
}
