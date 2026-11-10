"use client";

import { useTranslation } from "react-i18next";
import { Mail, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { websiteContact, websiteEmailHref, websiteWhatsappHref } from "@/lib/websiteContact";

/**
 * "Want a fully custom website? Contact us by email or WhatsApp." `banner` sits under the editor title; `inline` is the short line in the
 * Settings card. The WhatsApp button exists only when a number is configured (see lib/websiteContact.ts).
 */
export function CustomWebsiteNotice({ variant }: { variant: "banner" | "inline" }) {
  const { t } = useTranslation();
  const contact = websiteContact();
  const emailHref = websiteEmailHref(contact, t("pageEditor.customSite.subject"), t("pageEditor.customSite.message"));
  const whatsappHref = websiteWhatsappHref(contact, t("pageEditor.customSite.message"));

  if (variant === "inline") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="custom-website-inline">
        {t("pageEditor.customSite.body")}{" "}
        <a href={emailHref} className="font-medium text-foreground underline" data-testid="custom-website-email">
          {contact.email}
        </a>
        {whatsappHref && (
          <>
            {" · "}
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline" data-testid="custom-website-whatsapp">
              {t("pageEditor.customSite.whatsapp")}
            </a>
          </>
        )}
      </p>
    );
  }

  return (
    <div
      role="note"
      data-testid="custom-website-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-50"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-medium">{t("pageEditor.customSite.title")}</p>
          <p>{t("pageEditor.customSite.body")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="bg-background text-foreground">
          <a href={emailHref} data-testid="custom-website-email">
            <Mail aria-hidden="true" />
            {contact.email}
          </a>
        </Button>
        {whatsappHref && (
          <Button asChild variant="outline" size="sm" className="bg-background text-foreground">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" data-testid="custom-website-whatsapp">
              <MessageCircle aria-hidden="true" />
              {t("pageEditor.customSite.whatsapp")}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
