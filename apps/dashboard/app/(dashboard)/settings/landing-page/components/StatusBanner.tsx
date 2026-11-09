"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { GymPageStatus, PageBadTextFieldEntry } from "@gymos/types";
import { badTextTarget, gateCodeAnchor, isGateCode, statusBannerCodes } from "@/lib/landingPage";
import { badFieldLabel, reasonLine } from "./pageCopy";

function AnchorOrLink({ href, children }: { href: string; children: React.ReactNode }) {
  return href.startsWith("#") ? (
    <a href={href} className="underline">
      {children}
    </a>
  ) : (
    <Link href={href} className="underline">
      {children}
    </Link>
  );
}

/**
 * The banner at the top of the editor and the publish screen: why the page is offline (one sentence per code, bulleted in
 * checklist order when several), or that GymOS took it down. The taken-down banner has no Appeal button (24.11 owns the writer).
 */
export function StatusBanner({ status, role }: { status: GymPageStatus; role: string }) {
  const { t } = useTranslation();

  if (status.state === "taken_down") {
    return (
      <div role="alert" data-testid="banner-taken-down" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-100">
        {t("pageEditor.banner.takenDown")}
      </div>
    );
  }

  if (status.state === "offline_suspended") {
    return (
      <div role="status" data-testid="banner-suspended" className="rounded-md border bg-muted/40 p-4 text-sm">
        {t("pageEditor.banner.suspended")}
      </div>
    );
  }

  const codes = statusBannerCodes(status);
  if (codes.length === 0) return null;

  const nameReleased = codes.length === 1 && codes[0] === "name_released";
  const wayOut = nameReleased ? (role === "owner" ? t("pageEditor.banner.claimAndPublish") : t("pageEditor.banner.askOwnerToClaim")) : t("pageEditor.banner.fixAndPublish");

  function pointer(code: string) {
    if (!isGateCode(code)) return null;
    if (code === "bad_text" && status.bad_text_fields.length > 0) {
      return (
        <>
          {status.bad_text_fields.map((f: PageBadTextFieldEntry, i: number) => {
            const target = badTextTarget(f.field);
            return (
              <span key={i} className="ml-2">
                <AnchorOrLink href={target.href}>{target.kind === "anchor" ? t("pageEditor.banner.goToField", { field: badFieldLabel(t, f) }) : t("pageEditor.banner.fixElsewhere", { field: badFieldLabel(t, f) })}</AnchorOrLink>
              </span>
            );
          })}
        </>
      );
    }
    return (
      <span className="ml-2">
        <AnchorOrLink href={gateCodeAnchor(code)}>{t("pageEditor.banner.goToSection")}</AnchorOrLink>
      </span>
    );
  }

  return (
    <div role="alert" data-testid="banner-offline" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-50">
      {codes.length === 1 ? (
        <p>
          {t("pageEditor.banner.offlineOne", { reason: reasonLine(t, codes[0], status) })}
          {pointer(codes[0])}
        </p>
      ) : (
        <>
          <p>{t("pageEditor.banner.offlineMany")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {codes.map((c) => (
              <li key={c}>
                {reasonLine(t, c, status)}
                {pointer(c)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{wayOut}</p>
    </div>
  );
}
