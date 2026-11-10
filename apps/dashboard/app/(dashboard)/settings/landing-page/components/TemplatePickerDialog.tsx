"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PAGE_TEMPLATES, type PageTemplateId } from "@/lib/pageTemplates";
import { TemplateThumb } from "./TemplateThumb";

/**
 * The template choice, in a modal. One radio card per offered template (native radios, so the arrow keys and the group name come for free).
 * [Use this template] hands the choice to the editor, which either republishes at once (a live page) or remembers it for the publish screen;
 * the editor returns an error message to show here, or null when it is done and the dialog may close. The owner of this component mounts it
 * with a `key` that changes on every opening, so each opening starts from the current choice with no old error (no reset effect needed).
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  selected,
  live,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: PageTemplateId;
  /** The page is live: choosing another template republishes it now. */
  live: boolean;
  onUse: (id: PageTemplateId) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [pick, setPick] = useState<PageTemplateId>(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function use() {
    if (busy) return;
    if (pick === selected) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onUse(pick);
      if (message) setError(message);
      else onOpenChange(false);
    } catch {
      setError(t("pageEditor.templates.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl" data-testid="template-dialog">
        <DialogHeader>
          <DialogTitle>{t("pageEditor.templates.chooseTitle")}</DialogTitle>
          <DialogDescription>{t("pageEditor.templates.chooseBody")}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
          <legend className="sr-only">{t("pageEditor.sections.template")}</legend>
          {PAGE_TEMPLATES.map((id) => {
            const checked = pick === id;
            return (
              <label
                key={id}
                data-testid={`template-option-${id}`}
                data-checked={checked}
                className={`relative flex cursor-pointer flex-col gap-2 rounded-md border-2 p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <input type="radio" name="page-template" value={id} checked={checked} onChange={() => setPick(id)} className="sr-only" />
                <TemplateThumb id={id} />
                <span className="flex items-center gap-2 font-medium">
                  {t(`pageEditor.templates.${id}`)}
                  {id === selected && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{t("pageEditor.templates.current")}</span>}
                  {checked && <Check className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />}
                </span>
                <span className="text-muted-foreground">{t(`pageEditor.templates.${id}Description`)}</span>
              </label>
            );
          })}
        </fieldset>
        {pick !== selected && live && (
          <p className="text-sm text-muted-foreground" data-testid="template-live-note">
            {t("pageEditor.templates.liveNote")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600" data-testid="template-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void use()}>
            {busy ? t("pageEditor.templates.applying") : t("pageEditor.templates.use")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
