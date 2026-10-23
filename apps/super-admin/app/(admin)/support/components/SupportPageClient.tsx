"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  runDueFactorResets,
  type DisclosureInboxRow,
  type SupportAccountRow,
  type SupportAssignmentRow,
  type SupportLifecycleRow,
  type SupportLockRow,
} from "../actions";
import { AssignSupportModal } from "./AssignSupportModal";
import type { SupportMessage } from "./constants";
import { CreateSupportAccountModal } from "./CreateSupportAccountModal";
import { DisclosureInbox } from "./DisclosureInbox";
import { SupportAccountsPanel } from "./SupportAccountsPanel";
import { SupportAssignmentsPanel } from "./SupportAssignmentsPanel";
import { SupportLifecyclePanel } from "./SupportLifecyclePanel";
import { SupportLocksPanel } from "./SupportLocksPanel";

export const SUPPORT_TABS = ["accounts", "assignments", "locks", "lifecycle", "disclosure"] as const;
type SupportTab = (typeof SUPPORT_TABS)[number];

function parseTab(value: string | null | undefined): SupportTab {
  return (SUPPORT_TABS as readonly string[]).includes(value ?? "") ? (value as SupportTab) : "accounts";
}

function TabError({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  );
}

/**
 * Story 23.4 / 23.12: GymOS support. Top buttons open the create and assign modals; the five sections are tabs (the selected tab is in
 * the URL as `?tab=`). Names and addresses are visible here only.
 */
export function SupportPageClient({
  initialAccounts,
  assignments,
  gyms,
  locks = [],
  lifecycle = [],
  disclosures,
  loadErrors = {},
}: {
  initialAccounts: SupportAccountRow[];
  assignments: SupportAssignmentRow[];
  gyms: { id: string; name: string }[];
  /** Story 23.10: accounts locked by a safety limit, waiting for a Super Admin review. */
  locks?: SupportLockRow[];
  /** Story 23.11: recertification, reset and contact state per activated person. */
  lifecycle?: SupportLifecycleRow[];
  /** Story 23.8: Owner disclosure requests. */
  disclosures: DisclosureInboxRow[];
  /** Load failures per tab: shown in the tab instead of an empty list that would read as "nothing here". */
  loadErrors?: { locks?: string; lifecycle?: string; disclosure?: string };
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SupportTab>(parseTab(searchParams?.get("tab")));
  const [message, setMessage] = useState<SupportMessage | null>(null);
  const [modal, setModal] = useState<"create" | "assign" | null>(null);
  const [pending, startTransition] = useTransition();
  const badges: Partial<Record<SupportTab, number>> = {
    locks: locks.length,
    disclosure: disclosures.filter((r) => r.overdue).length,
  };

  function selectTab(value: string) {
    const next = parseTab(value);
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function runDue() {
    startTransition(async () => {
      const { data, error } = await runDueFactorResets();
      setMessage(
        error
          ? { kind: "error", text: error.message }
          : { kind: "ok", text: t("support.lifecycle.ran", { done: data?.done ?? 0, failed: data?.failed ?? 0 }) },
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("support.title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setModal("create")}>{t("support.top.create")}</Button>
          <Button variant="outline" onClick={() => setModal("assign")}>
            {t("support.top.assign")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={runDue}>
            {t("support.top.runDue")}
          </Button>
        </div>
      </div>

      {message && (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}

      <Tabs value={tab} onValueChange={selectTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {SUPPORT_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`support.tabs.${key}`)}
                {(badges[key] ?? 0) > 0 && (
                  <span className="ml-2 rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">{badges[key]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="accounts">
          <SupportAccountsPanel accounts={initialAccounts} lifecycle={lifecycle} onMessage={setMessage} />
        </TabsContent>
        <TabsContent value="assignments">
          <SupportAssignmentsPanel assignments={assignments} onMessage={setMessage} />
        </TabsContent>
        <TabsContent value="locks">
          {loadErrors.locks ? <TabError text={loadErrors.locks} /> : <SupportLocksPanel locks={locks} onMessage={setMessage} />}
        </TabsContent>
        <TabsContent value="lifecycle">
          {loadErrors.lifecycle ? <TabError text={loadErrors.lifecycle} /> : <SupportLifecyclePanel rows={lifecycle} onMessage={setMessage} />}
        </TabsContent>
        <TabsContent value="disclosure">
          {loadErrors.disclosure ? <TabError text={loadErrors.disclosure} /> : <DisclosureInbox requests={disclosures} onMessage={setMessage} />}
        </TabsContent>
      </Tabs>

      {modal === "create" && <CreateSupportAccountModal onClose={() => setModal(null)} onMessage={setMessage} />}
      {modal === "assign" && <AssignSupportModal accounts={initialAccounts} gyms={gyms} onClose={() => setModal(null)} onMessage={setMessage} />}
    </div>
  );
}
