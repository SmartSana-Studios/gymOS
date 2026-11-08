"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Circle, FileText, Plus } from "lucide-react";
import { PAGE_CONTENT_LANGUAGES, type PageContentLanguage } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { languageTabStatus } from "@/lib/landingPage";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import { aboutCharacters, type EditorErrors, type EditorFormState, type FieldError } from "@/lib/pageEditorForm";
import { SectionHeader } from "../../SectionHeader";
import { languageName, type T } from "./pageCopy";

/** From this many shown tabs the tab list becomes a native dropdown. */
export const TAB_DROPDOWN_FROM = 5;

export function fieldErrorText(t: T, e: FieldError): string {
  const field = e.field ? t(`pageEditor.fields.${e.field}`) : "";
  const label = e.lang ? t("pageEditor.fieldWithLanguage", { field, language: languageName(t, e.lang) }) : field;
  switch (e.code) {
    case "angle":
      return t("pageEditor.errors.angle", { field: label });
    case "tooLong":
      return t("pageEditor.errors.tooLong", { field: label });
    default:
      return t(`pageEditor.errors.${e.code}`);
  }
}

export function PageTextSection({
  form,
  setForm,
  errors,
  shown,
  setShown,
  active,
  setActive,
  defaultLanguage,
  minChars,
  live,
  otherCompleteLanguage,
  onRemove,
  textFocusRef,
}: {
  form: EditorFormState;
  setForm: (next: EditorFormState) => void;
  errors: EditorErrors;
  shown: PageContentLanguage[];
  setShown: (next: PageContentLanguage[]) => void;
  active: PageContentLanguage;
  setActive: (l: PageContentLanguage) => void;
  defaultLanguage: PageContentLanguage;
  minChars: number;
  live: boolean;
  /** For a language: does another shown language stay complete without it? (Drives the live-page warning in the remove dialog.) */
  otherCompleteLanguage: (lang: PageContentLanguage) => boolean;
  /** Clears the language's two fields with its own save. Resolves to an error message, or null. */
  onRemove: (lang: PageContentLanguage) => Promise<string | null>;
  textFocusRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [announce, setAnnounce] = useState("");
  const [removing, setRemoving] = useState<PageContentLanguage | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const missing = PAGE_CONTENT_LANGUAGES.filter((l) => !shown.includes(l));

  const progress = (l: PageContentLanguage) => {
    const characters = aboutCharacters(form.about[l] ?? "");
    const hasText = characters > 0 || (form.services[l] ?? "").trim() !== "";
    return languageTabStatus({ code: l, characters, hasText }, minChars);
  };
  const hasError = (l: PageContentLanguage) => Boolean(errors[`about.${l}`] || errors[`services.${l}`]);

  function statusWords(l: PageContentLanguage): string {
    if (hasError(l)) return t("pageEditor.text.needsAttention");
    const s = progress(l);
    if (s.status === "complete") return t("pageEditor.text.complete");
    if (s.status === "empty") return t("pageEditor.text.empty");
    return t("pageEditor.text.needsMore", { count: s.needed });
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % shown.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + shown.length) % shown.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = shown.length - 1;
    else return;
    e.preventDefault();
    setActive(shown[next]);
    tabRefs.current[shown[next]]?.focus();
  }

  function addLanguage(l: PageContentLanguage) {
    setShown([...shown, l]);
    setActive(l);
    setAnnounce(t("pageEditor.text.added", { language: languageName(t, l) }));
    // focus the new tab's About field once it renders
    setTimeout(() => document.getElementById(`about-${l}`)?.focus(), 0);
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    const lang = removing;
    const message = await onRemove(lang);
    setRemoveBusy(false);
    if (message) {
      setRemoveError(message);
      return;
    }
    setRemoving(null);
    setShown(shown.filter((x) => x !== lang));
    setActive(defaultLanguage);
    setTimeout(() => tabRefs.current[defaultLanguage]?.focus(), 0);
  }

  const lang = active;
  const aboutErr = errors[`about.${lang}`];
  const servicesErr = errors[`services.${lang}`];
  const chars = aboutCharacters(form.about[lang] ?? "");
  const servicesChars = Array.from(form.services[lang] ?? "").length;
  const name = languageName(t, lang);
  const aboutLabel = t("pageEditor.fieldWithLanguage", { field: t("pageEditor.fields.about"), language: name });
  const servicesLabel = t("pageEditor.fieldWithLanguage", { field: t("pageEditor.fields.services"), language: name });
  const removeWouldTakeOffline = live && !otherCompleteLanguage(lang);

  return (
    <Card id={PAGE_SECTION_IDS.text} data-testid="section-text">
      <SectionHeader icon={FileText} accent="emerald" title={t("pageEditor.sections.text")} description={t("pageEditor.sections.textDescription")} />
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("pageEditor.text.helper")}</p>

        <div className="flex flex-wrap items-center gap-2">
          {shown.length >= TAB_DROPDOWN_FROM ? (
            <select
              aria-label={t("pageEditor.text.languageSelect")}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={active}
              onChange={(e) => setActive(e.target.value as PageContentLanguage)}
            >
              {shown.map((l) => (
                <option key={l} value={l}>
                  {languageName(t, l)} - {statusWords(l)}
                </option>
              ))}
            </select>
          ) : (
            <div role="tablist" aria-label={t("pageEditor.text.tabsLabel")} className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
              {shown.map((l, i) => {
                const selected = l === active;
                const s = progress(l);
                const Icon = hasError(l) ? AlertCircle : s.status === "complete" ? CheckCircle2 : Circle;
                return (
                  <button
                    key={l}
                    ref={(el) => {
                      tabRefs.current[l] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${l}`}
                    aria-selected={selected}
                    aria-controls="text-panel"
                    tabIndex={selected ? 0 : -1}
                    aria-label={t("pageEditor.text.tabName", { language: languageName(t, l), status: statusWords(l), index: i + 1, count: shown.length })}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-background shadow" : "text-muted-foreground"}`}
                    onClick={() => setActive(l)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    <span>{languageName(t, l)}</span>
                    <span className="text-xs font-normal">{statusWords(l)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {missing.length === 1 && (
            <Button type="button" variant="outline" size="sm" onClick={() => addLanguage(missing[0])}>
              <Plus />
              {t("pageEditor.text.addOne", { language: languageName(t, missing[0]) })}
            </Button>
          )}
          {missing.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-haspopup="menu">
                  <Plus />
                  {t("pageEditor.text.addMany")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {missing.map((l) => (
                  <DropdownMenuItem key={l} onSelect={() => addLanguage(l)}>
                    {languageName(t, l)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>

        <div role="tabpanel" id="text-panel" aria-labelledby={`tab-${lang}`} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`about-${lang}`}>{aboutLabel}</Label>
            <textarea
              id={`about-${lang}`}
              ref={lang === active ? textFocusRef : undefined}
              value={form.about[lang] ?? ""}
              rows={6}
              aria-invalid={aboutErr ? true : undefined}
              aria-describedby={aboutErr ? `about-${lang}-error about-${lang}-help` : `about-${lang}-help`}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => setForm({ ...form, about: { ...form.about, [lang]: e.target.value } })}
            />
            <p id={`about-${lang}-help`} className="text-xs text-muted-foreground" data-testid="about-counter">
              {t("pageEditor.text.counter", { count: chars, max: 2000 })} - {t("pageEditor.text.progress", { count: chars, min: minChars })}
            </p>
            {aboutErr && <p id={`about-${lang}-error`} role="alert" className="text-sm text-red-600">{fieldErrorText(t, aboutErr)}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`services-${lang}`}>{servicesLabel}</Label>
            <textarea
              id={`services-${lang}`}
              value={form.services[lang] ?? ""}
              rows={4}
              aria-invalid={servicesErr ? true : undefined}
              aria-describedby={servicesErr ? `services-${lang}-error services-${lang}-help` : `services-${lang}-help`}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => setForm({ ...form, services: { ...form.services, [lang]: e.target.value } })}
            />
            <p id={`services-${lang}-help`} className="text-xs text-muted-foreground">
              {t("pageEditor.text.servicesHelper")} {t("pageEditor.text.counter", { count: servicesChars, max: 2000 })}
            </p>
            {servicesErr && <p id={`services-${lang}-error`} role="alert" className="text-sm text-red-600">{fieldErrorText(t, servicesErr)}</p>}
          </div>
          {lang !== defaultLanguage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRemoveError(null);
                setRemoving(lang);
              }}
            >
              {t("pageEditor.text.remove", { language: name })}
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={removing !== null} onOpenChange={(o) => !removeBusy && !o && setRemoving(null)}>
        <DialogContent closeLabel={t("common.close")}>
          {removing && (
            <>
              <DialogHeader>
                <DialogTitle>{t("pageEditor.text.removeTitle", { language: languageName(t, removing) })}</DialogTitle>
                <DialogDescription>{t("pageEditor.text.removeBody", { language: languageName(t, removing) })}</DialogDescription>
              </DialogHeader>
              {live && !otherCompleteLanguage(removing) && <p role="alert" className="text-sm text-amber-700">{t("pageEditor.text.removeOffline")}</p>}
              {removeError && <p role="alert" className="text-sm text-red-600">{removeError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" autoFocus disabled={removeBusy} onClick={() => setRemoving(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" variant="destructive" disabled={removeBusy} onClick={() => void confirmRemove()}>
                  {removeBusy ? t("common.saving") : removeWouldTakeOffline ? t("pageEditor.text.removeAndUnpublish") : t("pageEditor.text.remove", { language: languageName(t, removing) })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
