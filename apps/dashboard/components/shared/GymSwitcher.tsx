"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MemberRole } from "@/services/session";
import { switchActiveGym } from "@/app/(dashboard)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABEL_KEY: Record<MemberRole, string> = {
  member: "role.member",
  coach: "role.coach",
  receptionist: "role.receptionist",
  manager: "role.manager",
  supervisor: "role.supervisor",
  owner: "role.owner",
};

/**
 * Story 9.6: Sidebar gym switcher. Only mounted when the caller holds 2+
 * active gym bindings (`availableGyms.length > 1`, checked by the caller --
 * Sidebar.tsx) -- AC #3's "no switcher for single-gym" is enforced by that
 * caller-side check plus session.ts's own data-layer computation, not by
 * this component hiding itself.
 *
 * Mounted in the Sidebar header, replacing the plain gym-name text with an
 * identically-styled interactive trigger (matching precedent: dashboard
 * "workspace switcher" UX conventions put this control at the top, next to
 * the current org/workspace name, not buried in a footer utility row).
 *
 * Pending/optimistic/error-revert shape mirrors LanguageToggle.tsx. Unlike
 * it, a successful switch does not `router.refresh()` in place: it does a
 * full navigation to `/` (Story 17.3 review, see `handleSwitch`).
 *
 * Story 1.20 review correction: this comment used to argue that
 * FrontDeskAlertPanel stays correct because its React Query cache is keyed
 * by a `gymId` prop. That was true before Story 1.19, and is no longer the
 * mechanism: FrontDeskAlertPanel renders from `(dashboard)/page.tsx` -- i.e.
 * inside `children`, inside the Fragment that `(dashboard)/layout.tsx` now
 * keys on `gymId` -- so a gym switch unmounts and remounts it wholesale,
 * cache and all. The query key is still correct, it is just no longer what
 * is doing the work. Reasoning from the old rationale would mislead anyone
 * debugging that panel, which is the exact failure Story 1.19 existed to fix.
 *
 * Story 1.19 correction: this comment previously claimed `router.refresh()`
 * alone was sufficient for every Server-Component/Server-Action-fetched page
 * in this app (AD-7/AD-8). It is not. `refresh()` re-renders Server
 * Components but deliberately PRESERVES client-component state, so any page
 * seeding `useState` from server props (SettingsForm does so ~10 times) kept
 * rendering the previous gym's data while this switcher's own label -- a
 * plain prop with no local state -- correctly updated. The fix lives in
 * `(dashboard)/layout.tsx`, which keys the page subtree on `gymId` so a
 * switch remounts rather than re-renders. (Since Story 17.3's review the
 * switch is a full page load anyway; the key still guards any later
 * `router.refresh()` that picks up a gym changed elsewhere.)
 */
export function GymSwitcher({
  currentGymId,
  currentGymName,
  availableGyms,
  railAware,
  onNavigate,
}: {
  currentGymId: string;
  currentGymName: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
  railAware: boolean;
  // Story 1.19 review finding: closes the <768px nav overlay after a switch,
  // exactly as every nav <Link> in Sidebar.tsx already does. Without it this
  // was the only interactive control in the drawer that left it open -- on
  // mobile the page behind remounted onto the new gym while the user stared
  // at an unchanged full-screen drawer, with nothing indicating the switch
  // had worked. Distinct from resetting `mobileNavOpen` via a remount key,
  // which (dashboard)/layout.tsx deliberately does not do.
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleSwitch(gymId: string) {
    if (gymId === currentGymId || pending) return;
    setPending(true);
    setError(false);
    try {
      const { error: switchError } = await switchActiveGym({ gymId });
      if (switchError) {
        setError(true);
        setPending(false);
        return;
      }
      onNavigate?.();
      // Story 17.3 review: a switch always lands on `/`, whose landing
      // redirect routes by the NEW gym's role. Refreshing in place left a
      // user who switched from a coach gym to a staff gym on `/coach/overview`,
      // with the whole gym counted as "My Members". A full document
      // navigation rather than `router.push("/")`, for the reason
      // update-password-form.tsx records: the client Router Cache can serve a
      // `/` rendered under the old session. `replace` keeps Back from
      // returning to a page that belonged to the old gym's role. `pending`
      // stays set, since this page is unloading.
      window.location.replace("/");
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            title={currentGymName}
            aria-label={t("sidebar.switchGym")}
            className={cn(
              // Sidebar-surface tokens, not primary-foreground: this trigger
              // sits on --sidebar, which is dark in BOTH themes, whereas
              // --primary-foreground inverts to near-black in .dark and would
              // be invisible here.
              "-mx-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-sm text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground disabled:opacity-50",
              railAware && "hidden lg:flex",
            )}
          >
            <span className="max-w-[170px] truncate">{pending ? t("sidebar.switchingGym") : currentGymName}</span>
            <ChevronsUpDown size={13} className="shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {availableGyms.map((gym) => (
            <DropdownMenuItem
              key={gym.gymId}
              disabled={pending}
              onSelect={() => handleSwitch(gym.gymId)}
              className={cn("flex flex-col items-start gap-0", gym.gymId === currentGymId && "bg-accent")}
            >
              <span className="truncate font-medium">{gym.gymName}</span>
              <span className="text-xs text-muted-foreground">{t(ROLE_LABEL_KEY[gym.role])}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* --destructive darkens to 30.6% lightness in .dark, which on the
          (now correctly dark) sidebar is unreadable; --sidebar-destructive
          stays legible against it in both themes. */}
      {error && <p className="text-xs text-sidebar-destructive">{t("sidebar.gymSwitchError")}</p>}
    </div>
  );
}
