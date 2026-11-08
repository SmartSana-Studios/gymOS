"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { PAGE_CONTENT_LANGUAGES, gymCategoryLabel, type PagePublishGateCode } from "@gymos/types";
import type { LandingPageData } from "@/services/landing-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LANDING_PAGE_PATH, badTextTarget, gateCodeAnchor, pagePublicHost, sortGateCodes } from "@/lib/landingPage";
import { DEFAULT_PAGE_TEMPLATE, isOfferedTemplate } from "@/lib/pageTemplates";
import { openDays, publishRows, type PublishRow } from "@/lib/publishRows";
import { loadLandingPageAction, publishPageAction } from "../actions";
import { StatusBadge } from "./StatusBadge";
import { StatusBanner } from "./StatusBanner";
import { UnpublishDialog } from "./UnpublishDialog";
import { badFieldLabel, formatPrice, itemLine, languageName, pageMediaUrl } from "./pageCopy";

const TYPE_KEY: Record<string, string> = {
  pay_per_session: "plans.types.payPerSession",
  monthly: "plans.types.monthly",
  coach_inclusive: "plans.types.coachInclusive",
  class_only: "plans.types.classOnly",
};

/** What becomes public, the attestation, [Publish page] and [Unpublish]. The server result is trusted: the list is the snapshot. */
export function PublishScreen({ initial }: { initial: LandingPageData }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(initial);
  const [attested, setAttested] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedMissing, setFailedMissing] = useState<PagePublishGateCode[] | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  const { status, pageName, role } = data;
  const snap = status.snapshot;
  const host = pageName.state === "active" && pageName.name ? pagePublicHost(pageName.name) : null;
  const takenDown = status.state === "taken_down";
  const live = status.state === "published" || status.state === "offline_suspended";
  const known = sortGateCodes(status.missing) as PagePublishGateCode[];
  const notReady = failedMissing ?? (known.length > 0 ? known : null);

  async function refresh() {
    try {
      const { data: fresh } = await loadLandingPageAction();
      if (fresh) setData(fresh);
    } catch {
      /* keep what is on screen */
    }
  }

  async function publish() {
    if (!attested || publishing || takenDown) return;
    setPublishing(true);
    setError(null);
    setFailedMissing(null);
    try {
      const template = isOfferedTemplate(status.template) ? status.template : DEFAULT_PAGE_TEMPLATE;
      const { data: result, error: err } = await publishPageAction(template);
      if (err) {
        setError(err.message);
        if (err.code === "taken_down") await refresh();
        return;
      }
      if (result && !result.published) {
        // The server says no and wrote nothing: show what is missing, from its answer.
        setFailedMissing(sortGateCodes(result.missing) as PagePublishGateCode[]);
        await refresh();
        return;
      }
      setSuccess(true);
      await refresh();
      setTimeout(() => successRef.current?.focus(), 0);
    } catch {
      setError(t("pageEditor.errors.load_failed"));
    } finally {
      setPublishing(false);
    }
  }

  async function copyLink() {
    if (!host) return;
    try {
      await navigator.clipboard.writeText(`https://${host}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const na = <span className="text-muted-foreground">{t("pageEditor.publish.notIncluded")}</span>;

  function renderValue(row: PublishRow) {
    switch (row.id) {
      case "name":
        return snap.name;
      case "category":
        return snap.category ? gymCategoryLabel(snap.category, i18n.language) : na;
      case "images":
        return (
          <div className="flex flex-wrap gap-2">
            {snap.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pageMediaUrl(snap.logo)} alt={t("pageEditor.images.logo")} className="h-12 w-auto rounded border" />
            )}
            {snap.banner && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pageMediaUrl(snap.banner)} alt={t("pageEditor.images.banner")} className="h-12 w-auto rounded border" />
            )}
            {!snap.logo && !snap.banner && na}
          </div>
        );
      case "languages":
        return (
          <ul>
            {status.languages.map((l) => (
              <li key={l.code}>
                {l.complete
                  ? languageName(t, l.code)
                  : t("pageEditor.publish.notOffered", { language: languageName(t, l.code), count: l.characters, min: status.about_min_chars })}
              </li>
            ))}
          </ul>
        );
      case "plans":
        return snap.plans && snap.plans.length > 0 ? (
          <ul className="space-y-1">
            {snap.plans.map((p, i) => (
              <li key={i}>
                {p.name} · {t(TYPE_KEY[p.type] ?? "plans.types.monthly")} · {formatPrice(p.price, p.currency, i18n.language)}
                {p.type === "pay_per_session" ? ` / ${t("pageEditor.plans.perSession")}` : p.duration_days ? ` / ${t("plans.durationDaysLabel", { days: p.duration_days })}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          na
        );
      case "address": {
        const parts = [snap.address, snap.city, snap.country].filter(Boolean).join(", ");
        return parts ? (
          <>
            {parts}
            {snap.map ? ` (${t("pageEditor.publish.mapYes")})` : ` (${t("pageEditor.publish.mapNo")})`}
          </>
        ) : (
          na
        );
      }
      case "hours": {
        const days = openDays(snap.hours);
        return days.length > 0 ? days.map((d) => `${t(`pageEditor.days.${d.day}`)} ${d.open}-${d.close}`).join(" · ") : na;
      }
      case "contact":
        return snap.contact ? [snap.contact.phone, snap.contact.whatsapp ? `WhatsApp ${snap.contact.whatsapp}` : null].filter(Boolean).join(" · ") : na;
      case "gallery":
        return snap.gallery && snap.gallery.length > 0 ? t("pageEditor.publish.galleryCount", { count: snap.gallery.length }) : na;
      case "color":
        return snap.color ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-5 rounded border" style={{ backgroundColor: snap.color }} />
            {snap.color}
          </span>
        ) : (
          na
        );
      default: {
        // about_xx / services_xx: one row per content language; "Not included" for a language the snapshot leaves out
        const key = row.keys[0] as "about_en" | "about_fr" | "services_en" | "services_fr";
        const value = snap[key];
        return value ? <p className="whitespace-pre-line">{value}</p> : na;
      }
    }
  }

  function rowLabel(row: PublishRow): string {
    if (row.lang) {
      const base = row.id.startsWith("about") ? t("pageEditor.fields.about") : t("pageEditor.fields.services");
      return t("pageEditor.fieldWithLanguage", { field: base, language: languageName(t, row.lang) });
    }
    return t(`pageEditor.publish.rows.${row.id}`);
  }

  return (
    <div className="space-y-4" data-testid="publish-screen">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="outline" size="sm">
            <Link href={LANDING_PAGE_PATH}>
              <ArrowLeft />
              {t("pageEditor.publish.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">{t("pageEditor.publish.title")}</h1>
        </div>
        <StatusBadge state={status.state} />
      </div>

      <StatusBanner status={status} role={role} />

      {host ? (
        <p className="text-sm" data-testid="public-address">
          {t("pageEditor.publish.address", { address: `https://${host}` })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("pageEditor.publish.noName")}</p>
      )}

      {notReady && !live && (
        <div role="alert" data-testid="publish-not-ready" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-50">
          <p>{t("pageEditor.publish.notReady")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {notReady.map((c) => (
              <li key={c}>
                {itemLine(t, c, status)}{" "}
                {c === "bad_text" && status.bad_text_fields.length > 0 ? (
                  status.bad_text_fields.map((f, i) => {
                    const target = badTextTarget(f.field);
                    return (
                      <Link key={i} href={target.kind === "anchor" ? `${LANDING_PAGE_PATH}${target.href}` : target.href} className="mr-2 underline">
                        {badFieldLabel(t, f)}
                      </Link>
                    );
                  })
                ) : (
                  <Link href={`${LANDING_PAGE_PATH}${gateCodeAnchor(c)}`} className="underline">
                    {t("pageEditor.checklist.goTo")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {success && host && (
        <div ref={successRef} tabIndex={-1} role="status" data-testid="publish-success" className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 outline-none dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-50">
          <p className="font-medium">{t("pageEditor.publish.success", { host })}</p>
          <p>{t("pageEditor.publish.twoMinutes")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>
              {copied ? t("pageEditor.publish.copied") : t("pageEditor.publish.copyLink")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`https://${host}`} target="_blank" rel="noopener noreferrer">
                {t("pageEditor.publish.viewPage")}
              </a>
            </Button>
          </div>
        </div>
      )}

      {status.state === "published" && !success && host && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button asChild size="sm" variant="outline">
            <a href={`https://${host}`} target="_blank" rel="noopener noreferrer">
              {t("pageEditor.publish.viewPage")}
            </a>
          </Button>
          <span className="text-muted-foreground">{t("pageEditor.liveInfo")}</span>
        </div>
      )}

      <p className="text-sm font-medium">{t("pageEditor.publish.intro")}</p>
      <Card>
        <CardContent className="p-0">
          <dl className="divide-y" data-testid="publish-list">
            {publishRows(PAGE_CONTENT_LANGUAGES).map((row) => (
              <div key={row.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[12rem_1fr]" data-testid={`publish-row-${row.id}`}>
                <dt className="font-medium">{rowLabel(row)}</dt>
                <dd>{renderValue(row)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {status.languages.some((l) => !l.complete) && (
        <p className="text-sm text-muted-foreground">
          <Link href={`${LANDING_PAGE_PATH}#page-text`} className="underline">
            {t("pageEditor.publish.editText")}
          </Link>
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-testid="never-shown">
        {t("pageEditor.publish.neverShown")}
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600" data-testid="publish-error">
          {error}
        </p>
      )}

      {takenDown ? null : live ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setUnpublishOpen(true)}>
            {t("pageEditor.header.unpublish")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="publishAttest" checked={attested} onCheckedChange={(v) => setAttested(v === true)} />
            <Label htmlFor="publishAttest" className="text-sm leading-snug">
              {t("pageEditor.publish.attest")}
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button asChild variant="outline">
              <Link href={LANDING_PAGE_PATH}>{t("pageEditor.publish.backButton")}</Link>
            </Button>
            <Button type="button" disabled={!attested || publishing} onClick={() => void publish()}>
              {publishing ? t("pageEditor.publish.publishing") : t("pageEditor.publish.button")}
            </Button>
          </div>
        </div>
      )}

      <UnpublishDialog open={unpublishOpen} onOpenChange={setUnpublishOpen} onDone={async () => { setSuccess(false); await refresh(); }} />
    </div>
  );
}
