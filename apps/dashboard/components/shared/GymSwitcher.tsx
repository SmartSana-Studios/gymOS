"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
 * Pending/optimistic/error-revert/`router.refresh()` shape mirrors
 * LanguageToggle.tsx exactly. `router.refresh()` alone is sufficient for
 * every Server-Component/Server-Action-fetched page in this app (AD-7/AD-8)
 * -- FrontDeskAlertPanel's React Query cache (keyed by `gymId`, passed down
 * as a prop) naturally re-keys onto the new gym once its prop changes,
 * since `gymId` is part of its query key.
 */
export function GymSwitcher({
  currentGymId,
  currentGymName,
  availableGyms,
  railAware,
}: {
  currentGymId: string;
  currentGymName: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
  railAware: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
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
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
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
              "-mx-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-sm text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground disabled:opacity-50",
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
      {error && <p className="text-xs text-destructive">{t("sidebar.gymSwitchError")}</p>}
    </div>
  );
}
