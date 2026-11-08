"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { isValidPageName, type GymPageName } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SECTION_IDS, PAGE_PUBLIC_DOMAIN, pagePublicHost } from "@/lib/landingPage";
import { SectionHeader } from "../../SectionHeader";
import { claimPageNameAction } from "../actions";

/** The first rule the typed name breaks, one at a time, or null. */
export function pageNameRuleError(name: string): "length" | "chars" | "edge" | "double" | "digits" | null {
  if (name.length < 3 || name.length > 30) return "length";
  if (/--/.test(name) || /^xn--/.test(name)) return /^xn--/.test(name) ? "chars" : "double";
  if (!/^[a-z0-9-]+$/.test(name)) return "chars";
  if (name.startsWith("-") || name.endsWith("-")) return "edge";
  if (/^[0-9]+$/.test(name)) return "digits";
  return isValidPageName(name) ? null : "chars";
}

export function PageNameSection({
  pageName,
  isOwner,
  live,
  onChanged,
  onToast,
}: {
  pageName: GymPageName;
  isOwner: boolean;
  /** The page is published (or offline-by-suspension): the idle-reservation note applies to an unpublished page only. */
  live: boolean;
  onChanged: () => Promise<void> | void;
  onToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasName = pageName.state === "active" || pageName.state === "reserved";
  const renamesLeft = Math.max(0, 2 - pageName.completed_renames);
  const addressPreview = value && !pageNameRuleError(value) ? `https://${pagePublicHost(value)}` : `https://${t("pageEditor.name.placeholder")}.${PAGE_PUBLIC_DOMAIN}`;

  function startOpen() {
    setValue("");
    setRuleError(null);
    setServerError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const name = value.trim().toLowerCase();
    const rule = pageNameRuleError(name);
    if (rule) {
      setRuleError(t(`pageEditor.name.rules.${rule}`));
      return;
    }
    setRuleError(null);
    setServerError(null);
    setSubmitting(true);
    try {
      const { data, error } = await claimPageNameAction(name);
      if (error) {
        setServerError(error.message);
        return;
      }
      setOpen(false);
      await onChanged();
      onToast(data?.state === "held" ? t("pageEditor.name.toastHeld") : t("pageEditor.name.toastClaimed"));
    } catch {
      setServerError(t("pageEditor.name.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card id={PAGE_SECTION_IDS.name} data-testid="section-name">
      <SectionHeader icon={Link2} accent="blue" title={t("pageEditor.sections.name")} description={t("pageEditor.sections.nameDescription")} />
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" data-testid="page-name-state">
            {hasName && pageName.name ? (
              <span className="font-medium">{pagePublicHost(pageName.name)}</span>
            ) : (
              <span className="text-muted-foreground">{t("pageEditor.name.notClaimed")}</span>
            )}
            {pageName.state === "held" && pageName.pending_name && (
              <p className="mt-1 text-muted-foreground">{t("pageEditor.name.underReview", { name: pageName.pending_name })}</p>
            )}
          </div>
          {isOwner && (
            <Button type="button" variant="outline" size="sm" onClick={startOpen}>
              {hasName ? t("pageEditor.name.change") : t("pageEditor.name.claim")}
            </Button>
          )}
        </div>
        {!isOwner && <p className="text-sm text-muted-foreground">{t("pageEditor.name.ownerOnly")}</p>}
        {!live && hasName && <p className="text-sm text-muted-foreground">{t("pageEditor.name.reservedWhileOffline")}</p>}
      </CardContent>

      {isOwner && (
        <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
          <DialogContent closeLabel={t("common.close")}>
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>{hasName ? t("pageEditor.name.changeTitle") : t("pageEditor.name.claimTitle")}</DialogTitle>
                <DialogDescription>{t("pageEditor.name.hint")}</DialogDescription>
              </DialogHeader>
              {hasName && (
                <p className="text-sm text-muted-foreground">
                  {renamesLeft > 0 ? t("pageEditor.name.renameInfo", { count: renamesLeft }) : t("pageEditor.name.renamesUsed")}
                </p>
              )}
              {(!hasName || renamesLeft > 0) && (
                <div className="space-y-2">
                  <Label htmlFor="pageNameInput">{t("pageEditor.name.label")}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="pageNameInput"
                      value={value}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={ruleError || serverError ? true : undefined}
                      aria-describedby="pageNameMessages"
                      onChange={(e) => {
                        setValue(e.target.value.toLowerCase());
                        setRuleError(null);
                        setServerError(null);
                      }}
                    />
                    <span className="text-sm text-muted-foreground">.{PAGE_PUBLIC_DOMAIN}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{t("pageEditor.name.address", { address: addressPreview })}</p>
                  <div id="pageNameMessages" role="alert" className="text-sm text-red-600">
                    {ruleError ?? serverError}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                  {t("common.cancel")}
                </Button>
                {(!hasName || renamesLeft > 0) && (
                  <Button type="submit" disabled={submitting}>
                    {submitting ? t("common.saving") : hasName ? t("pageEditor.name.rename") : t("pageEditor.name.claimButton")}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
