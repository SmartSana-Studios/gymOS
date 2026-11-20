"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MAX_CLASS_SLOTS } from "@gymos/types";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FULL_DAY_KEYS, MONDAY_FIRST_WEEKDAYS } from "@/lib/classTimes";
import type { RowsValidation, TimeRow } from "./weeklyRows";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Story 29.2 (UX AD-19): the weekly-times editor. One row per time (Day select, 24-hour Time, Remove), [+ Add a time], the counter
 * "[n] of 14" always visible, inline per-row errors wired with aria-describedby, and the time-zone line. It holds no state of its own beyond
 * focus: the rows, the sorting and the validation belong to the modal, which also needs them on save.
 */
export function WeeklyTimesEditor({
  rows,
  validation,
  showErrors,
  timezone,
  editNotice,
  announcement,
  focusKey,
  onRowChange,
  onRowBlur,
  onAdd,
  onRemove,
}: {
  rows: TimeRow[];
  validation: RowsValidation;
  /** Errors appear only after a failed submit (validate on submit, UX-DR11). */
  showErrors: boolean;
  timezone: string | null;
  /** The info notice above "Weekly times" when the class has upcoming sessions. */
  editNotice: boolean;
  /** Text for the polite live region ("Weekly times sorted"); empty when there is nothing to announce. */
  announcement: string;
  /** Row whose Day select takes focus (the row [+ Add a time] just appended). */
  focusKey: string | null;
  onRowChange: (key: string, patch: Partial<Pick<TimeRow, "weekday" | "time">>) => void;
  onRowBlur: (key: string) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const daySelectRefs = useRef(new Map<string, HTMLSelectElement>());
  const atLimit = rows.length >= MAX_CLASS_SLOTS;

  useEffect(() => {
    if (focusKey) daySelectRefs.current.get(focusKey)?.focus();
  }, [focusKey]);

  return (
    <div className="space-y-3" role="group" aria-labelledby="weeklyTimesLabel">
      {editNotice && (
        <p className="flex items-start gap-2 rounded-md bg-blue-50 p-2 text-sm text-blue-900">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t("classes.times.editNotice")}</span>
        </p>
      )}

      <div className="flex items-baseline justify-between">
        <span id="weeklyTimesLabel" className="text-sm font-medium">
          {t("classes.times.label")}
        </span>
        <span className="text-sm text-muted-foreground">{t("classes.times.counter", { n: rows.length })}</span>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => {
          const errors = showErrors ? validation.rows[row.key] : undefined;
          const dayId = `weeklyDay-${row.key}`;
          const timeId = `weeklyTime-${row.key}`;
          const errorId = `weeklyError-${row.key}`;
          const message = errors?.day
            ? t("classes.times.error.day")
            : errors?.time
              ? t("classes.times.error.time")
              : errors?.duplicate
                ? t("classes.times.error.duplicate")
                : null;
          const dayName = row.weekday === "" ? "" : t(FULL_DAY_KEYS[Number(row.weekday)]);
          return (
            <li
              key={row.key}
              className="space-y-1 rounded-md border p-2"
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                onRowBlur(row.key);
              }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1 space-y-1">
                  <Label htmlFor={dayId}>{t("classes.times.day")}</Label>
                  <select
                    id={dayId}
                    ref={(el) => {
                      if (el) daySelectRefs.current.set(row.key, el);
                      else daySelectRefs.current.delete(row.key);
                    }}
                    value={row.weekday}
                    onChange={(e) => onRowChange(row.key, { weekday: e.target.value })}
                    aria-invalid={errors?.day ? true : undefined}
                    aria-describedby={errors?.day ? errorId : undefined}
                    className={selectClassName}
                  >
                    <option value="" />
                    {MONDAY_FIRST_WEEKDAYS.map((day) => (
                      <option key={day} value={String(day)}>
                        {t(FULL_DAY_KEYS[day])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-28 space-y-1">
                  <Label htmlFor={timeId}>{t("classes.times.time")}</Label>
                  <Input
                    id={timeId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="18:30"
                    maxLength={5}
                    value={row.time}
                    onChange={(e) => onRowChange(row.key, { time: e.target.value })}
                    aria-invalid={errors?.time || errors?.duplicate ? true : undefined}
                    aria-describedby={errors?.time || errors?.duplicate ? errorId : undefined}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("classes.times.removeAria", { day: dayName, time: row.time }).trim()}
                  onClick={() => onRemove(row.key)}
                >
                  {t("classes.times.remove")}
                </Button>
              </div>
              {message && (
                <p id={errorId} className="text-sm text-red-600">
                  {message}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {showErrors && validation.none && (
        <p id="weeklyTimesNone" className="text-sm text-red-600">
          {t("classes.times.error.none")}
        </p>
      )}

      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={atLimit ? true : undefined}
          aria-describedby={atLimit ? "weeklyTimesLimit" : undefined}
          onClick={atLimit ? undefined : onAdd}
        >
          {t("classes.times.add")}
        </Button>
        {atLimit && (
          <p id="weeklyTimesLimit" className="text-sm text-muted-foreground">
            {t("classes.times.limit")}
          </p>
        )}
      </div>

      {timezone && <p className="text-xs text-muted-foreground">{t("classes.times.timezone", { zone: timezone })}</p>}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
