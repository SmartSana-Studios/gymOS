import nodemailer from "nodemailer";

/**
 * Story 22.8: the Super Admin app's only way to send email (recovery codes and notices).
 *
 * One SMTP path everywhere: locally it targets Supabase's Inbucket (MAIL_SMTP_HOST=127.0.0.1,
 * MAIL_SMTP_PORT=54325, no auth; mail shows at http://127.0.0.1:54324), in production it targets
 * Resend's SMTP endpoint (smtp.resend.com, user "resend", password = the Resend API key).
 *
 * Server-only: reads secrets from process.env and must never be imported from a Client Component.
 * Fails closed: without configuration nothing is sent and the caller is told, never a silent success.
 * Never logs an address, a subject or a body, and never throws.
 */

export type MailMessage = { to: string; subject: string; text: string; html?: string };
export type MailResult = { ok: true } | { ok: false; reason: "not_configured" | "invalid_message" | "send_failed" };

/** Reads MAIL_SMTP_HOST, MAIL_SMTP_PORT, MAIL_SMTP_USER, MAIL_SMTP_PASS and MAIL_FROM. */
export type MailEnv = Record<string, string | undefined>;

type Transport = { sendMail(message: Record<string, unknown>): Promise<unknown> };
export type TransportFactory = (options: Record<string, unknown>) => Transport;

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|::1)$/;
const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

export function readMailConfig(env: MailEnv) {
  const host = env.MAIL_SMTP_HOST?.trim();
  const from = env.MAIL_FROM?.trim();
  const port = Number(env.MAIL_SMTP_PORT ?? 587);
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const user = env.MAIL_SMTP_USER?.trim();
  const pass = env.MAIL_SMTP_PASS;
  return {
    host,
    port,
    from,
    // 465 is implicit TLS; 587 / 25 use STARTTLS.
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
    // Credentials or codes must never go out in clear text: with auth, or any non-local host, STARTTLS is
    // required (a downgrade makes the send fail). Only the unauthenticated local catcher may skip TLS.
    requireTLS: port !== 465 && (Boolean(user && pass) || !LOCAL_HOST.test(host)),
  };
}

/** Header-injection guard: a CR or LF anywhere in a header-bound value would let a caller add headers. */
function clean(value: string): string | null {
  return /[\r\n]/.test(value) ? null : value.trim();
}

/** The SMTP server's refusal text for the operator log: single line, capped, with addresses and API keys removed. */
export function smtpReason(error: unknown): string {
  const response = (error as { response?: unknown } | null)?.response;
  if (typeof response !== "string") return "";
  return response
    .replace(/[^\s<>",;]+@[^\s<>",;]+/g, "[address]")
    .replace(/\bre_[A-Za-z0-9_-]+/g, "[key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function createMailer(env: MailEnv, factory: TransportFactory = (o) => nodemailer.createTransport(o)) {
  return async function send(message: MailMessage): Promise<MailResult> {
    const config = readMailConfig(env);
    if (!config) return { ok: false, reason: "not_configured" };

    const to = clean(message.to);
    const subject = clean(message.subject);
    if (!to || !subject || !ADDRESS.test(to) || !message.text) return { ok: false, reason: "invalid_message" };

    try {
      const transport = factory({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTLS,
        auth: config.auth,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      await transport.sendMail({ from: config.from, to, subject, text: message.text, html: message.html });
      return { ok: true };
    } catch (error) {
      // The error class and SMTP code, plus the server's own refusal text (nodemailer's `response`, e.g.
      // "550 ... domain is not verified"), which is what tells an operator WHY (EMESSAGE alone does not).
      // Not `error.message`, and the response is scrubbed of anything address- or key-shaped first.
      const code = (error as { code?: unknown } | null)?.code;
      const reason = smtpReason(error);
      if (reason) console.error("[mail] send failed", typeof code === "string" ? code : "unknown", reason);
      else console.error("[mail] send failed", typeof code === "string" ? code : "unknown");
      return { ok: false, reason: "send_failed" };
    }
  };
}

export const sendMail = (message: MailMessage): Promise<MailResult> => createMailer(process.env)(message);
