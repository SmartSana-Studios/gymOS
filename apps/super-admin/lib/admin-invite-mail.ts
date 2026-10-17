import type { MailMessage } from "@/lib/mail";

/** Emails sent when a Super Admin account is created or an existing account is promoted. Plain text.
 * The temporary password is in the "created" mail on purpose (owner decision, 2026-10-17): it is
 * single use (the account must change it at first sign-in) and also shown once on screen. */

export type InviteLocale = "en" | "fr";
type Built = Omit<MailMessage, "to">;

export function adminCreatedMail(opts: { email: string; tempPassword: string; loginUrl: string | null; locale: InviteLocale }): Built {
  const { email, tempPassword, loginUrl, locale } = opts;
  if (locale === "fr") {
    return {
      subject: "Vous avez été ajouté comme Super Admin GymOS",
      text: [
        "Vous avez été ajouté comme Super Admin GymOS.",
        "",
        loginUrl ? `Connexion : ${loginUrl}/auth/login` : "",
        `E-mail : ${email}`,
        `Mot de passe temporaire : ${tempPassword}`,
        "",
        "Vous devrez choisir un nouveau mot de passe à la première connexion. Ouvrez ensuite « Sécurité » et configurez tout de suite deux authentificateurs (ou un authentificateur et une adresse de récupération).",
        "",
        "Si vous n'attendiez pas ce message, ne vous connectez pas et prévenez l'exploitant de la plateforme.",
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
    };
  }
  return {
    subject: "You have been added as a GymOS Super Admin",
    text: [
      "You have been added as a GymOS Super Admin.",
      "",
      loginUrl ? `Sign in: ${loginUrl}/auth/login` : "",
      `Email: ${email}`,
      `Temporary password: ${tempPassword}`,
      "",
      "You will be asked to choose a new password at your first sign-in. Then open Security and set up two authenticators (or one authenticator and a recovery email) straight away.",
      "",
      "If you did not expect this message, do not sign in and tell the platform operator.",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
  };
}

export function adminPromotedMail(opts: { loginUrl: string | null; locale: InviteLocale }): Built {
  const { loginUrl, locale } = opts;
  if (locale === "fr") {
    return {
      subject: "Accès Super Admin GymOS accordé à votre compte",
      text: [
        "Votre compte GymOS existant a reçu l'accès Super Admin. Connectez-vous avec votre mot de passe habituel.",
        "",
        loginUrl ? `Connexion : ${loginUrl}/auth/login` : "",
        "",
        "Ouvrez ensuite « Sécurité » et configurez tout de suite deux authentificateurs (ou un authentificateur et une adresse de récupération).",
        "",
        "Si vous n'attendiez pas ce message, prévenez l'exploitant de la plateforme.",
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
    };
  }
  return {
    subject: "Super Admin access granted to your GymOS account",
    text: [
      "Your existing GymOS account has been given Super Admin access. Sign in with your usual password.",
      "",
      loginUrl ? `Sign in: ${loginUrl}/auth/login` : "",
      "",
      "Then open Security and set up two authenticators (or one authenticator and a recovery email) straight away.",
      "",
      "If you did not expect this message, tell the platform operator.",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
  };
}
