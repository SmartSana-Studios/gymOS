import { randomBytes, randomUUID } from "node:crypto";

import type { MailMessage } from "@/lib/mail";

/**
 * Story 23.4: the support invite link. The token is '<invite id>.<64 hex>' (the id lets the database count wrong
 * secrets against one invite); only its SHA-256 is stored. The link goes to the dashboard app's public invite route.
 */

export const SUPPORT_EMAIL_DOMAIN = "@gymosapps.com";

export function generateSupportInviteToken(): string {
  return `${randomUUID()}.${randomBytes(32).toString("hex")}`;
}

/** The dashboard origin from configuration, never from the request (a forged Host header must not redirect the link). */
export function dashboardBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const production = env.NODE_ENV === "production";
  const configured = env.DASHBOARD_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    const schemeOk = url.protocol === "https:" || (!production && url.protocol === "http:");
    return bare && schemeOk ? url.origin : null;
  } catch {
    return null;
  }
}

export function supportInviteLink(origin: string, token: string): string {
  return `${origin}/support-invite?t=${encodeURIComponent(token)}`;
}

export function isSupportEmail(email: string): boolean {
  const v = email.trim().toLowerCase();
  return /^[^@\s]+@gymosapps\.com$/.test(v);
}

/** Link only: no password, no code. Plain text. */
export function supportInviteMail(opts: { link: string; locale: "en" | "fr" }): Omit<MailMessage, "to"> {
  if (opts.locale === "fr") {
    return {
      subject: "Invitation au support GymOS",
      text: [
        "Vous avez été invité à rejoindre le support GymOS.",
        "",
        `Ouvrez ce lien pour choisir votre mot de passe et configurer votre authentificateur : ${opts.link}`,
        "",
        "Le lien est à usage unique et expire dans 24 heures. Ne le transmettez à personne.",
        "Si vous n'attendiez pas ce message, ne l'ouvrez pas et prévenez l'exploitant de la plateforme.",
      ].join("\n"),
    };
  }
  return {
    subject: "You have been invited to GymOS support",
    text: [
      "You have been invited to join GymOS support.",
      "",
      `Open this link to choose your password and set up your authenticator: ${opts.link}`,
      "",
      "The link works once and expires in 24 hours. Do not share it with anyone.",
      "If you did not expect this message, do not open it and tell the platform operator.",
    ].join("\n"),
  };
}
