"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GymListRow, TierOption } from "@/services/gyms";
import { CreateGymModal } from "./CreateGymModal";
import { GymLifecycleDialog } from "./GymLifecycleDialog";
import { deactivateGym, reinstateGym, suspendGym } from "../actions";

const STATUS_OPTIONS = ["", "active", "suspended", "deactivated"] as const;
const STATUS_LABEL_KEY: Record<(typeof STATUS_OPTIONS)[number], string> = {
  "": "gyms.statusAll",
  active: "gyms.create.statusActive",
  suspended: "gyms.create.statusSuspended",
  deactivated: "gyms.create.statusDeactivated",
};

export function GymsPageClient({
  initialGyms,
  total,
  page,
  pageSize,
  search,
  status,
  tiers,
}: {
  initialGyms: GymListRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  tiers: TierOption[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; inviteLink?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [lifecycleGym, setLifecycleGym] = useState<{
    gym: GymListRow;
    action: "suspend" | "deactivate" | "reinstate";
  } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Resync the search box with the URL's `search` param when it changes
  // externally (e.g. browser back/forward) -- otherwise the input keeps
  // showing stale text that no longer matches the applied filter. Already a
  // documented, accepted narrow-risk pattern (Story 1.6 deferred-work.md) --
  // not redesigned here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(search);
  }, [search]);

  function updateParams(next: { search?: string; status?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      if (next.search) params.set("search", next.search);
      else params.delete("search");
    }
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    params.set("page", String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  // A plain status message auto-dismisses; one carrying the invite link stays
  // on screen (no timer) until the admin explicitly closes it -- otherwise
  // there's no time to copy the link before it vanishes, and (until Story
  // 2.1 wires up real SMS) this is the only way anyone without server/log
  // access can get it at all.
  function showToast(message: string, inviteLink?: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setLinkCopied(false);
    setToast({ message, inviteLink });
    if (!inviteLink) {
      toastTimerRef.current = setTimeout(() => setToast(null), 4000);
    }
  }

  function handleCreated(ownerPhone: string, smsSent: boolean, ownerInviteLink: string) {
    setModalOpen(false);
    showToast(
      smsSent
        ? t("gyms.toast.createdSms", { phone: ownerPhone })
        : t("gyms.toast.createdNoSms", { phone: ownerPhone }),
      smsSent ? undefined : ownerInviteLink,
    );
    router.refresh();
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
    } catch {
      // Clipboard API can be denied (permissions, insecure context) -- the
      // link is still selectable/visible in the toast as a fallback, so this
      // is silent rather than surfacing a second error on top of a success.
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("gyms.title")}</h1>
        <Button onClick={() => setModalOpen(true)}>{t("gyms.createGym")}</Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={t("gyms.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") updateParams({ search: searchInput, page: 1 });
          }}
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => updateParams({ status: e.target.value, page: 1 })}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL_KEY[s])}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => updateParams({ search: searchInput, page: 1 })}>
          {t("gyms.search")}
        </Button>
      </div>

      {initialGyms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {total === 0 && !search && !status ? (
            <>
              <p className="text-sm text-muted-foreground">{t("gyms.emptyNoGyms")}</p>
              <Button onClick={() => setModalOpen(true)}>{t("gyms.createGymButton")}</Button>
            </>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("gyms.emptyNoMatch")}</p>
          ) : (
            // total > 0 but this page has no rows -- a stale `page` param
            // past the last page (e.g. after a filter shrank the result
            // set), not "no matches."
            <>
              <p className="text-sm text-muted-foreground">{t("gyms.emptyNoPageRows")}</p>
              <Button variant="outline" onClick={() => updateParams({ page: 1 })}>
                {t("gyms.backToPage1")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("gyms.table.gymName")}</th>
                <th className="p-3 font-medium">{t("gyms.table.owner")}</th>
                <th className="p-3 font-medium">{t("gyms.table.created")}</th>
                <th className="p-3 font-medium">{t("gyms.table.tier")}</th>
                <th className="p-3 font-medium">{t("gyms.table.status")}</th>
                <th className="p-3 font-medium">{t("gyms.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {initialGyms.map((gym) => (
                <tr
                  key={gym.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => router.push(`/gyms/${gym.id}`)}
                >
                  <td className="p-3">{gym.name}</td>
                  <td className="p-3">
                    {gym.ownerName ?? "—"}
                    {gym.ownerPhone ? ` (${gym.ownerPhone})` : ""}
                  </td>
                  <td className="p-3">
                    {new Date(gym.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3">{gym.tierName}</td>
                  <td className="p-3">
                    {(() => {
                      const key = STATUS_LABEL_KEY[gym.status as (typeof STATUS_OPTIONS)[number]];
                      return key ? t(key) : gym.status;
                    })()}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {gym.status === "active" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "suspend" })}
                          >
                            {t("gyms.actions.suspend")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "deactivate" })}
                          >
                            {t("gyms.actions.deactivate")}
                          </Button>
                        </>
                      )}
                      {gym.status === "suspended" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "reinstate" })}
                          >
                            {t("gyms.actions.reinstate")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "deactivate" })}
                          >
                            {t("gyms.actions.deactivate")}
                          </Button>
                        </>
                      )}
                      {gym.status === "deactivated" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLifecycleGym({ gym, action: "reinstate" })}
                        >
                          {t("gyms.actions.reinstate")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("gyms.pagination.previous")}
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              onClick={() => updateParams({ page: p })}
            >
              {p}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("gyms.pagination.next")}
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      <CreateGymModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        tiers={tiers}
      />

      {lifecycleGym && (
        <GymLifecycleDialog
          gym={lifecycleGym.gym}
          action={lifecycleGym.action}
          onClose={() => setLifecycleGym(null)}
          onDone={(warning) => {
            setLifecycleGym(null);
            if (warning) showToast(warning);
            router.refresh();
          }}
          runAction={
            lifecycleGym.action === "suspend"
              ? suspendGym
              : lifecycleGym.action === "deactivate"
                ? deactivateGym
                : reinstateGym
          }
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          <p>{toast.message}</p>
          {toast.inviteLink && (
            <div className="mt-2 space-y-2">
              <Input
                readOnly
                value={toast.inviteLink}
                onFocus={(e) => e.currentTarget.select()}
                className="border-primary-foreground/30 bg-primary-foreground/10 text-xs text-primary-foreground"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => copyInviteLink(toast.inviteLink!)}
                >
                  {linkCopied ? t("gyms.toast.linkCopied") : t("gyms.toast.copyLink")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-primary-foreground hover:text-primary-foreground"
                  onClick={() => setToast(null)}
                >
                  {t("gyms.toast.dismiss")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
