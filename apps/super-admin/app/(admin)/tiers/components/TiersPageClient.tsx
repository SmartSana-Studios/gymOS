"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { TierRow } from "@/services/tiers";
import { TierModal } from "./TierModal";
import { deleteTier } from "../actions";

/** Display-only range derived from tier ordering (ascending monthly_price,
 * matching listTiersWithGymCounts' own order) -- "min" is never a stored
 * field (story 1-6 Dev Notes -> Open Question 1). */
function rangeLabel(tiers: TierRow[], index: number): string {
  const tier = tiers[index];
  const previousCap = index > 0 ? tiers[index - 1].memberCap : 0;
  const min = (previousCap ?? 0) + 1;
  if (tier.memberCap === null) {
    return `> ${previousCap ?? 0} members (no cap)`;
  }
  return `${min}–${tier.memberCap} members`;
}

export function TiersPageClient({ initialTiers }: { initialTiers: TierRow[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<TierRow | null>(null);
  const [confirmTier, setConfirmTier] = useState<TierRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function openCreate() {
    setEditingTier(null);
    setModalOpen(true);
  }

  function openEdit(tier: TierRow) {
    setEditingTier(tier);
    setModalOpen(true);
  }

  function openDeleteConfirm(tier: TierRow) {
    setConfirmTier(tier);
    setDeleteError(null);
    dialogRef.current?.showModal();
  }

  function closeDeleteConfirm() {
    dialogRef.current?.close();
    setConfirmTier(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!confirmTier) return;
    setDeleting(true);
    try {
      const { error } = await deleteTier(confirmTier.id);
      if (error) {
        // The tier was actually deleted -- only the audit entry failed to
        // write -- so this isn't a blocking error like a real deletion
        // failure; still close and refresh, just surface the warning.
        if (error.code === "audit_log_failed") {
          dialogRef.current?.close();
          setConfirmTier(null);
          showToast(error.message);
          router.refresh();
          return;
        }
        setDeleteError(error.message); // SA-06: "Inline in confirmation"
        return;
      }
      dialogRef.current?.close();
      setConfirmTier(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tier Management</h1>
        <Button onClick={openCreate}>+ Add Tier</Button>
      </div>

      {initialTiers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No tiers configured. Add your first tier.
          </p>
          <Button onClick={openCreate}>Add Tier</Button>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {initialTiers.map((tier, index) => (
            <div key={tier.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {tier.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    {rangeLabel(initialTiers, index)}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Monthly: XAF {tier.monthlyPrice.toLocaleString()} · Annual: XAF{" "}
                  {tier.annualPrice.toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(tier)}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => openDeleteConfirm(tier)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TierModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(warning) => {
          setModalOpen(false);
          if (warning) showToast(warning);
          router.refresh();
        }}
        editingTier={editingTier}
      />

      <dialog
        ref={dialogRef}
        onClose={closeDeleteConfirm}
        onCancel={(e) => {
          if (deleting) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">
            Delete {confirmTier?.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            This cannot be undone.
          </p>
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeDeleteConfirm} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : `Delete ${confirmTier?.name ?? ""}`}
            </Button>
          </div>
        </div>
      </dialog>

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
