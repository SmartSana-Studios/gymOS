/**
 * Delivers the owner's welcome message (sign-in address, phone, temporary password). A link can only travel on the
 * free-text WhatsApp channel (Evolution); the Twilio fallback is a fixed template that carries the password only. So:
 * try the free-text message first, and if it cannot be sent (not configured, instance down, thrown error) fall back
 * to the template, reporting `linkSent: false` so the screen can tell the admin to pass the address on.
 * Never throws.
 */
import { sendEvolutionApiMessage } from "./EvolutionApiMessageProvider";
import { sendTempPasswordMessage, type TempPasswordMessageResult } from "./sendTempPasswordMessage";

export async function deliverOwnerWelcome(args: {
  phone: string;
  tempPassword: string;
  /** The full text including the link; null when there is no sign-in address, then only the template is used. */
  welcomeMessage: string | null;
}): Promise<{ result: TempPasswordMessageResult; linkSent: boolean }> {
  if (args.welcomeMessage) {
    try {
      const viaEvolution = await sendEvolutionApiMessage(args.phone, args.welcomeMessage);
      if (viaEvolution.success) {
        return { result: { success: true, channel: "evolution" }, linkSent: true };
      }
    } catch {
      // fall through to the template
    }
  }
  try {
    return { result: await sendTempPasswordMessage(args.phone, args.tempPassword), linkSent: false };
  } catch (err) {
    return {
      result: {
        success: false,
        error: err instanceof Error ? err.message : "temp-password send threw unexpectedly",
      },
      linkSent: false,
    };
  }
}
