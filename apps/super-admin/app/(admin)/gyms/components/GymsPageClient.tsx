"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { GymListRow, TierOption } from "@/services/gyms";
import { CreateGymModal } from "./CreateGymModal";

export function GymsPageClient({
  initialGyms,
  tiers,
}: {
  initialGyms: GymListRow[];
  tiers: TierOption[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timer on unmount so a delayed setToast(null) never
  // fires after the component is gone (code review finding).
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function handleCreated(ownerPhone: string, smsSent: boolean) {
    setModalOpen(false);
    // Honest copy: sendInviteSms is currently a stub (no SMS provider
    // sandbox-verified yet, Story 2.1) -- previously this unconditionally
    // claimed "SMS sent" regardless of whether one actually was (code
    // review finding, resolved per Story 1.5's Open Question 3).
    setToast(
      smsSent
        ? `Gym created. SMS sent to ${ownerPhone}.`
        : `Gym created. Invite link generated for ${ownerPhone} — SMS delivery isn't connected yet.`,
    );
    router.refresh();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gyms</h1>
        <Button onClick={() => setModalOpen(true)}>+ Create Gym</Button>
      </div>

      {initialGyms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No gyms on the platform yet. Create the first one.
          </p>
          <Button onClick={() => setModalOpen(true)}>Create Gym</Button>
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
              </tr>
            </thead>
            <tbody>
              {initialGyms.map((gym) => (
                <tr key={gym.id} className="border-b last:border-0">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateGymModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        tiers={tiers}
      />

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
