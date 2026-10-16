import type { MailMessage } from "@/lib/mail";

/** Story 22.8: the four recovery emails, en and fr. Plain text only; codes and links, nothing else. */

export type MailLocale = "en" | "fr";
type Built = Omit<MailMessage, "to">;

const fmt = (iso: string, locale: MailLocale) =>
  new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

export function registerCodeMail(code: string, minutes: number, locale: MailLocale): Built {
  return locale === "fr"
    ? { subject: "Votre code de vérification GymOS", text: `Code de vérification de votre adresse de récupération : ${code}\n\nIl expire dans ${minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.` }
    : { subject: "Your GymOS verification code", text: `Verification code for your recovery address: ${code}\n\nIt expires in ${minutes} minutes. If you did not ask for this, ignore this message.` };
}

export function recoveryCodeMail(code: string, minutes: number, locale: MailLocale): Built {
  return locale === "fr"
    ? { subject: "Code de récupération GymOS", text: `Code de récupération de votre compte Super Admin : ${code}\n\nIl expire dans ${minutes} minutes. L'utiliser programme la suppression de vos authentificateurs ; vous serez prévenu et pourrez annuler. Si vous n'êtes pas à l'origine de cette demande, ne le communiquez à personne.` }
    : { subject: "GymOS recovery code", text: `Recovery code for your Super Admin account: ${code}\n\nIt expires in ${minutes} minutes. Using it schedules the removal of your authenticators; you will be notified and can cancel. If you did not ask for this, do not share it with anyone.` };
}

export function recoveryScheduledMail(applyAtIso: string, cancelLink: string, locale: MailLocale): Built {
  const when = fmt(applyAtIso, locale);
  return locale === "fr"
    ? { subject: "Récupération du compte GymOS programmée", text: `Une récupération a été demandée pour un compte Super Admin GymOS. Les authentificateurs seront supprimés le ${when}.\n\nSi c'est vous, il n'y a rien à faire. Sinon, annulez maintenant :\n${cancelLink}` }
    : { subject: "GymOS account recovery scheduled", text: `A recovery was requested for a GymOS Super Admin account. Its authenticators will be removed at ${when}.\n\nIf this was you, there is nothing to do. If not, cancel it now:\n${cancelLink}` };
}
