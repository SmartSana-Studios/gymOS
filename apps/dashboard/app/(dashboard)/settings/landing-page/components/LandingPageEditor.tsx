"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { PAGE_CONTENT_LANGUAGES, type PageContentLanguage, type PagePublishGateCode } from "@gymos/types";
import type { LandingPageData } from "@/services/landing-page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LANDING_PAGE_PUBLISH_PATH, PAGE_SECTION_IDS, initialShownLanguages, pickTextTab, predictedBreaks, type LanguageProgress } from "@/lib/landingPage";
import { DEFAULT_PAGE_TEMPLATE, isOfferedTemplate } from "@/lib/pageTemplates";
import {
  aboutCharacters,
  cleanForm,
  firstErrorLanguage,
  hasOpenDay,
  initialForm,
  removeLanguageInput,
  toSaveInput,
  validateForm,
  type EditorErrors,
  type EditorFormState,
} from "@/lib/pageEditorForm";
import { loadLandingPageAction, saveLandingPageAction } from "../actions";
import { Checklist, LanguagesOffered } from "./Checklist";
import { ContactSection, HoursSection, LocationSection } from "./ContentSections";
import { ImagesSection } from "./ImagesSection";
import { PageNameSection } from "./PageNameSection";
import { PageTextSection } from "./PageTextSection";
import { PlansSection, TemplateSection } from "./PlansTemplateSections";
import { StatusBadge } from "./StatusBadge";
import { StatusBanner } from "./StatusBanner";
import { UnpublishDialog } from "./UnpublishDialog";
import { itemLine } from "./pageCopy";

const FOCUS_ID: Record<string, string> = {
  address: "pageAddress",
  city: "pageCity",
  latlng: "pageLat",
  contact_phone: "pagePhone",
  contact_whatsapp: "pageWhatsapp",
};

export function LandingPageEditor({ initial }: { initial: LandingPageData }) {
  const { t } = useTranslation();
  const [data, setData] = useState(initial);
  const [form, setForm] = useState<EditorFormState>(() => initialForm(initial.content, initial.plans));
  // What was last saved (or loaded). The form differs from it = unsaved changes.
  const [baseline, setBaseline] = useState<EditorFormState>(() => initialForm(initial.content, initial.plans));
  const [errors, setErrors] = useState<EditorErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [warn, setWarn] = useState<PagePublishGateCode[] | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textFocusRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  // Every read gets a number; a response older than the latest one applied is dropped, so a slow stale read cannot overwrite fresher data.
  const issuedRef = useRef(0);
  const appliedRef = useRef(0);

  const { status, pageName, role } = data;
  const defaultLanguage = data.content.defaultLanguage;
  const minChars = status.about_min_chars;

  const [shown, setShown] = useState<PageContentLanguage[]>(() =>
    initialShownLanguages(
      PAGE_CONTENT_LANGUAGES,
      initial.content.defaultLanguage,
      new Map(PAGE_CONTENT_LANGUAGES.map((l) => [l, { about: initial.content.about[l], services: initial.content.services[l] }])),
    ),
  );
  const [active, setActive] = useState<PageContentLanguage>(() => {
    const progress = new Map<PageContentLanguage, LanguageProgress>(
      PAGE_CONTENT_LANGUAGES.map((l) => [l, { code: l, characters: aboutCharacters(initial.content.about[l]), hasText: false }]),
    );
    return pickTextTab(shown, progress, initial.content.defaultLanguage, initial.status.about_min_chars);
  });

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  /** Apply data from request number `seq` unless a newer response was already applied. */
  const applyData = useCallback((seq: number, fresh: LandingPageData) => {
    if (seq < appliedRef.current) return;
    appliedRef.current = seq;
    setData(fresh);
  }, []);

  /** Re-read the server's facts (status, name, media, plans). The form the Owner is typing in is left alone. */
  const refresh = useCallback(async () => {
    const seq = ++issuedRef.current;
    try {
      const { data: fresh } = await loadLandingPageAction();
      if (fresh) applyData(seq, fresh);
    } catch {
      /* keep what is on screen */
    }
  }, [applyData]);

  useEffect(() => {
    // not while a save is in flight: its own response carries the fresh data
    const onFocus = () => {
      if (!savingRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const progressNow = useMemo(() => {
    const m = new Map<PageContentLanguage, LanguageProgress>();
    for (const l of PAGE_CONTENT_LANGUAGES) {
      m.set(l, { code: l, characters: aboutCharacters(form.about[l] ?? ""), hasText: (form.about[l] ?? "").trim() !== "" || (form.services[l] ?? "").trim() !== "" });
    }
    return m;
  }, [form.about, form.services]);

  const hasContent = useMemo(() => new Set(PAGE_CONTENT_LANGUAGES.filter((l) => progressNow.get(l)?.hasText)), [progressNow]);

  function openTextTab() {
    setActive(pickTextTab(shown, progressNow, defaultLanguage, minChars));
    document.getElementById(PAGE_SECTION_IDS.text)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const isOwner = role === "owner";
  const live = status.state === "published";
  const takenDown = status.state === "taken_down";
  const canReview = status.missing.length === 0 && !takenDown;
  const template = isOfferedTemplate(status.template) ? status.template : DEFAULT_PAGE_TEMPLATE;
  const showTooLarge = status.missing.includes("too_large") && status.state !== "offline_gate";

  function focusFirstError(errs: EditorErrors) {
    const lang = firstErrorLanguage(errs);
    if (lang) {
      setActive(lang);
      const key = errs[`about.${lang}`] ? `about-${lang}` : `services-${lang}`;
      setTimeout(() => document.getElementById(key)?.focus(), 0);
      return;
    }
    const first = Object.keys(errs)[0];
    if (!first) return;
    const id = FOCUS_ID[first];
    const el = id ? document.getElementById(id) : document.getElementById(PAGE_SECTION_IDS.hours);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement | null)?.focus?.();
  }

  async function save(skipWarning = false) {
    if (saving) return;
    setSaveError(null);
    const cleaned = cleanForm(form);
    setForm(cleaned);
    const errs = validateForm(cleaned);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs);
      return;
    }
    if (!skipWarning) {
      const impact = predictedBreaks({
        state: status.state,
        publicPlanCount: data.plans.filter((p) => cleaned.plans[p.id]).length,
        longestAbout: Math.max(0, ...PAGE_CONTENT_LANGUAGES.map((l) => aboutCharacters(cleaned.about[l] ?? ""))),
        minAbout: minChars,
        city: cleaned.city,
        hasContact: cleaned.phone.trim() !== "" || cleaned.whatsapp.trim() !== "",
        hasOpenDay: hasOpenDay(cleaned),
      });
      if (impact.codes.length > 0) {
        setWarn(impact.codes);
        return;
      }
    }
    setWarn(null);
    setSaving(true);
    savingRef.current = true;
    const seq = ++issuedRef.current;
    try {
      const { data: fresh, error, reloadFailed } = await saveLandingPageAction(toSaveInput(cleaned));
      if (error) {
        setSaveError(error.message);
        return;
      }
      // the save is stored from here on
      setBaseline(cleaned);
      if (fresh) {
        applyData(seq, fresh);
        showToast(t("pageEditor.savedToast"));
      } else if (reloadFailed) {
        showToast(t("pageEditor.savedReloadFailed"));
        void refresh();
      }
    } catch {
      setSaveError(t("pageEditor.errors.load_failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeLanguage(lang: PageContentLanguage): Promise<string | null> {
    try {
      const seq = ++issuedRef.current;
      const { data: fresh, error, reloadFailed } = await saveLandingPageAction(removeLanguageInput(lang));
      if (error) return error.message;
      if (fresh) applyData(seq, fresh);
      else if (reloadFailed) void refresh();
      const cleared = (f: EditorFormState): EditorFormState => ({ ...f, about: { ...f.about, [lang]: "" }, services: { ...f.services, [lang]: "" } });
      setForm(cleared);
      setBaseline(cleared);
      showToast(t("pageEditor.text.removed", { language: t(`pageEditor.languages.${lang}`) }));
      return null;
    } catch {
      return t("pageEditor.errors.load_failed");
    }
  }

  // Remove saves only the two cleared fields, so what stays complete is what is SAVED, not what is typed and unsaved.
  const otherCompleteLanguage = (lang: PageContentLanguage) => status.languages.some((l) => l.code !== lang && l.complete);

  return (
    <div className="space-y-4" data-testid="landing-page-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="outline" size="sm">
            <Link
              href="/settings"
              onClick={(e) => {
                if (dirty && !window.confirm(t("pageEditor.unsavedConfirm"))) e.preventDefault();
              }}
            >
              <ArrowLeft />
              {t("pageEditor.backToSettings")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">{t("pageEditor.title")}</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge state={status.state} />
          <div className="flex flex-wrap justify-end gap-2">
            {status.state === "offline_name_released" && isOwner && (
              <Button asChild variant="outline" size="sm">
                <a href={`#${PAGE_SECTION_IDS.name}`}>{t("pageEditor.header.claimName")}</a>
              </Button>
            )}
            {(live || status.state === "offline_suspended") && (
              <Button type="button" variant="outline" onClick={() => setUnpublishOpen(true)}>
                {t("pageEditor.header.unpublish")}
              </Button>
            )}
            {!takenDown && (
              canReview ? (
                <Button asChild>
                  <Link
                    href={LANDING_PAGE_PUBLISH_PATH}
                    onClick={(e) => {
                      if (dirty && !window.confirm(t("pageEditor.unsavedConfirm"))) e.preventDefault();
                    }}
                  >
                    {live ? t("pageEditor.header.viewPublic") : t("pageEditor.header.reviewAndPublish")}</Link>
                </Button>
              ) : (
                <Button type="button" disabled data-testid="review-disabled">
                  {t("pageEditor.header.reviewAndPublish")}
                </Button>
              )
            )}
          </div>
        </div>
      </div>

      {status.state === "not_started" && <p className="text-sm text-muted-foreground">{t("pageEditor.notStarted")}</p>}
      {live && <p className="text-sm text-muted-foreground" data-testid="live-info">{t("pageEditor.liveInfo")}</p>}
      <StatusBanner status={status} role={role} onChanged={refresh} />
      {showTooLarge && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-50">
          {t("pageEditor.banner.tooLarge")}
        </div>
      )}

      <Checklist status={status} pageName={pageName} onOpenTextTab={openTextTab} />
      <LanguagesOffered status={status} hasContent={hasContent} onOpenTextTab={openTextTab} />

      <div className="grid grid-cols-1 gap-6">
        <PageNameSection pageName={pageName} isOwner={isOwner} live={live} onChanged={refresh} onToast={showToast} />
        <PageTextSection
          form={form}
          setForm={setForm}
          errors={errors}
          shown={shown}
          setShown={setShown}
          active={active}
          setActive={setActive}
          defaultLanguage={defaultLanguage}
          minChars={minChars}
          live={live}
          otherCompleteLanguage={otherCompleteLanguage}
          onRemove={removeLanguage}
          textFocusRef={textFocusRef}
        />
        <ImagesSection gymId={data.gymId} media={status.media} onChanged={refresh} onToast={showToast} />
        <LocationSection form={form} setForm={setForm} errors={errors} country={data.content.country} category={data.content.category} />
        <HoursSection form={form} setForm={setForm} errors={errors} />
        <ContactSection form={form} setForm={setForm} errors={errors} />
        <PlansSection plans={data.plans} values={form.plans} canAddPlan={true} onChange={(id, v) => setForm((f) => ({ ...f, plans: { ...f.plans, [id]: v } }))} />
        <TemplateSection selected={template} />
      </div>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="text-sm">
          {saveError ? (
            <span role="alert" className="text-red-600">
              {saveError}
            </span>
          ) : (
            live && <span className="text-muted-foreground">{t("pageEditor.liveInfo")}</span>
          )}
        </div>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t("common.saving") : t("pageEditor.save")}
        </Button>
      </div>

      <Dialog open={warn !== null} onOpenChange={(o) => !o && setWarn(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("pageEditor.warn.title")}</DialogTitle>
            <DialogDescription>{t("pageEditor.warn.body")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm">
            {(warn ?? []).map((c) => (
              <li key={c}>{itemLine(t, c, status)}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWarn(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void save(true)}>
              {t("pageEditor.warn.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnpublishDialog open={unpublishOpen} onOpenChange={setUnpublishOpen} onDone={async () => { await refresh(); showToast(t("pageEditor.unpublish.toast")); }} />

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
