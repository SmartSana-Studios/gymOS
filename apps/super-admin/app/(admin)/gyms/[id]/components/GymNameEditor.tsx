"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { renameGymSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GymDetail } from "@/services/gyms";
import { renameGym } from "../../actions";

/** SA-03 gym name in the page header with a pencil button; turns into an inline input with [Save] / [Cancel]. The new
 * name must be unique among gyms and the change is audited ("Gym renamed", old and new name). */
export function GymNameEditor({ gym, onSaved }: { gym: GymDetail; onSaved: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(gym.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kept locally after a save so the old name never shows while router.refresh() is in flight.
  const [savedName, setSavedName] = useState<string | null>(null);
  const current = savedName ?? gym.name;

  async function handleSave() {
    setError(null);
    const parsed = renameGymSchema.safeParse({ name: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }
    if (parsed.data.name === current) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const { error: actionError } = await renameGym(gym.id, parsed.data);
      if (actionError) {
        // The audit entry failed but the name did change: show the new name and the warning.
        if (actionError.code === "audit_log_failed") {
          setSavedName(parsed.data.name);
          setEditing(false);
          onSaved();
        }
        setError(actionError.message);
        return;
      }
      setSavedName(parsed.data.name);
      setEditing(false);
      onSaved();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-2xl font-semibold">{current}</h1>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label={t("gyms.detail.rename.button")}
            onClick={() => {
              setValue(current);
              setError(null);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          aria-label={t("gyms.detail.rename.label")}
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 max-w-sm text-lg font-semibold"
        />
        <Button type="submit" size="sm" disabled={saving}>
          {t("gyms.detail.rename.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => {
            setValue(current);
            setError(null);
            setEditing(false);
          }}
        >
          {t("gyms.detail.rename.cancel")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
