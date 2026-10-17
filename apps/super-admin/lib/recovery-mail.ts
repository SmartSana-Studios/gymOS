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

/** The login mailbox is told whenever the recovery address is set, changed or removed. */
export function recoveryEmailChangedMail(masked: string, locale: MailLocale): Built {
  return locale === "fr"
    ? { subject: "Adresse de récupération GymOS modifiée", text: `L'adresse de récupération de votre compte Super Admin GymOS est maintenant ${masked}.\n\nSi ce n'est pas vous, changez votre mot de passe et contactez l'exploitant de la plateforme immédiatement.` }
    : { subject: "GymOS recovery address changed", text: `The recovery address of your GymOS Super Admin account is now ${masked}.\n\nIf this was not you, change your password and contact the platform operator immediately.` };
}

export function recoveryEmailRemovedMail(locale: MailLocale): Built {
  return locale === "fr"
    ? { subject: "Adresse de récupération GymOS supprimée", text: "L'adresse de récupération de votre compte Super Admin GymOS a été supprimée ; toute récupération programmée est annulée.\n\nSi ce n'est pas vous, changez votre mot de passe et contactez l'exploitant de la plateforme immédiatement." }
    : { subject: "GymOS recovery address removed", text: "The recovery address of your GymOS Super Admin account was removed; any scheduled recovery was cancelled.\n\nIf this was not you, change your password and contact the platform operator immediately." };
}

/** Both mailboxes are told when a scheduled recovery is cancelled (by the link, or by the owner signing in). */
export function recoveryCancelledMail(locale: MailLocale): Built {
  return locale === "fr"
    ? { subject: "Récupération du compte GymOS annulée", text: "La récupération programmée de votre compte Super Admin GymOS a été annulée. Vos authentificateurs sont inchangés.\n\nSi vous n'êtes pas à l'origine de la demande initiale, changez votre mot de passe." }
    : { subject: "GymOS account recovery cancelled", text: "The scheduled recovery of your GymOS Super Admin account was cancelled. Your authenticators are unchanged.\n\nIf you did not make the original request, change your password." };
}
