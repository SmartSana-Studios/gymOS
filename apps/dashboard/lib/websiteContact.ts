// Where an owner who wants a fully custom website reaches us. The SAME two public variables the marketing site reads (apps/landing/lib/config.ts),
// so one value serves both: NEXT_PUBLIC_SUPPORT_EMAIL (default hello@gymosapps.com) and NEXT_PUBLIC_WHATSAPP_NUMBER (digits, country code first,
// e.g. 237670000000). With no WhatsApp number there is NO WhatsApp link: a dead wa.me/undefined link is worse than none. Next.js inlines
// NEXT_PUBLIC_* only for a literal `process.env.NAME`, so the defaults below name them literally.

export const DEFAULT_WEBSITE_CONTACT_EMAIL = "hello@gymosapps.com";

export interface WebsiteContact {
  email: string;
  /** Digits only, or "" when no WhatsApp number is configured. */
  whatsapp: string;
}

export function websiteContact(
  env: { email?: string; whatsapp?: string } = {
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  },
): WebsiteContact {
  return {
    email: env.email?.trim() || DEFAULT_WEBSITE_CONTACT_EMAIL,
    whatsapp: (env.whatsapp ?? "").replace(/[^0-9]/g, ""),
  };
}

export function websiteEmailHref(contact: WebsiteContact, subject: string, body: string): string {
  return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** `null` when no WhatsApp number is configured. */
export function websiteWhatsappHref(contact: WebsiteContact, message: string): string | null {
  return contact.whatsapp ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(message)}` : null;
}
