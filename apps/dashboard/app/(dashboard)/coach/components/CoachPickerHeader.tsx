"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";

import { Label } from "@/components/ui/label";

export interface PickerSelectCoach {
  id: string;
  name: string;
}

const MEMBER_ROUTE_RE = /^\/coach\/(?!classes$|overview$)[^/]+$/;

/**
 * Story 29.4 (UX AD-32): the picker's select and its read-only banner, rendered by coach/layout.tsx above the Classes and Members tabs for an Owner,
 * Supervisor or Manager. `coaches` is the gym's active coaches (the layout's one `list_picker_coaches()` read); the chosen coach is `?coach=<id>`, so back,
 * refresh and a shared link keep it. The select shows no value (and no banner) when the id is not one of them: an unavailable or deactivated coach "clears
 * the select".
 *
 * Choosing a coach:
 *   - from /coach with nothing chosen, go to Classes (the default tab);
 *   - on a member page, go to the new coach's Members tab (the member is almost certainly not theirs);
 *   - anywhere else (Classes, Members, the Overview notice), keep the page and every other parameter except `tab`.
 *
 * With nothing chosen the select takes focus. The banner is neutral (a border and an eye icon, not an info colour), always visible while a coach is chosen,
 * not dismissible, and the only `role="status"` of the header.
 */
export function CoachPickerHeader({ coaches }: { coaches: PickerSelectCoach[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectRef = useRef<HTMLSelectElement>(null);

  const requested = searchParams.get("coach");
  const chosen = coaches.find((coach) => coach.id.toLowerCase() === (requested ?? "").toLowerCase()) ?? null;

  useEffect(() => {
    if (!requested) selectRef.current?.focus();
  }, [requested]);

  function choose(coachId: string) {
    if (!coachId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.set("coach", coachId);
    if (pathname === "/coach" && !requested) {
      router.push(`/coach/classes?coach=${encodeURIComponent(coachId)}`);
    } else if (MEMBER_ROUTE_RE.test(pathname)) {
      router.push(`/coach?coach=${encodeURIComponent(coachId)}`);
    } else {
      router.push(`${pathname}?${params.toString()}`);
    }
  }

  if (coaches.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="coachPickerSelect">{t("coach.picker.label")}</Label>
        <select
          id="coachPickerSelect"
          ref={selectRef}
          value={chosen ? chosen.id : ""}
          onChange={(e) => choose(e.target.value)}
          className="flex h-9 min-w-56 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="" disabled>
            {t("coach.picker.label")}
          </option>
          {coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.name}
            </option>
          ))}
        </select>
        {chosen && (
          <div role="status" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <Eye className="size-4 shrink-0" aria-hidden="true" />
            <span>{t("coach.picker.banner", { name: chosen.name })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Reserves the select row while the search parameters resolve. Carries no text. */
export function CoachPickerHeaderFallback() {
  return <div className="h-9 w-72 animate-pulse rounded bg-primary/10" aria-hidden="true" />;
}
