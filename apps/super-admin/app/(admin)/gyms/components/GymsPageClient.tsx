"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GymListRow, TierOption } from "@/services/gyms";
import { CreateGymModal } from "./CreateGymModal";
import { GymLifecycleDialog } from "./GymLifecycleDialog";
import { deactivateGym, reinstateGym, suspendGym } from "../actions";

const STATUS_OPTIONS = ["", "active", "suspended", "deactivated"] as const;

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
  const [toast, setToast] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(search);
  const [lifecycleGym, setLifecycleGym] = useState<{
    gym: GymListRow;
    action: "suspend" | "deactivate" | "reinstate";
  } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Resync the search box with the URL's `search` param when it changes
  // externally (e.g. browser back/forward) -- otherwise the input keeps
  // showing stale text that no longer matches the applied filter.
  useEffect(() => {
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

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function handleCreated(ownerPhone: string, smsSent: boolean) {
    setModalOpen(false);
    showToast(
      smsSent
        ? `Gym created. SMS sent to ${ownerPhone}.`
        : `Gym created. Invite link generated for ${ownerPhone} — SMS delivery isn't connected yet.`,
    );
    router.refresh();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gyms</h1>
        <Button onClick={() => setModalOpen(true)}>+ Create Gym</Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Search gym name"
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
              {s === "" ? "All" : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => updateParams({ search: searchInput, page: 1 })}>
          Search
        </Button>
      </div>

      {initialGyms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {total === 0 && !search && !status ? (
            <>
              <p className="text-sm text-muted-foreground">
                No gyms on the platform yet. Create the first one.
              </p>
              <Button onClick={() => setModalOpen(true)}>Create Gym</Button>
            </>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No gyms match your search or filter.
            </p>
          ) : (
            // total > 0 but this page has no rows -- a stale `page` param
            // past the last page (e.g. after a filter shrank the result
            // set), not "no matches."
            <>
              <p className="text-sm text-muted-foreground">
                No gyms on this page.
              </p>
              <Button variant="outline" onClick={() => updateParams({ page: 1 })}>
                Back to page 1
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Gym Name</th>
                <th className="p-3 font-medium">Owner</th>
                <th className="p-3 font-medium">Created</th>
                <th className="p-3 font-medium">Tier</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Actions</th>
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
                  <td className="p-3 capitalize">{gym.status}</td>
                  <td className="p-3">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {gym.status === "active" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "suspend" })}
                          >
                            Suspend
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "deactivate" })}
                          >
                            Deactivate
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
                            Reinstate
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLifecycleGym({ gym, action: "deactivate" })}
                          >
                            Deactivate
                          </Button>
                        </>
                      )}
                      {gym.status === "deactivated" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLifecycleGym({ gym, action: "reinstate" })}
                        >
                          Reinstate
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
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            ←
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
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            →
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
          className="fixed bottom-4 right-4 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
