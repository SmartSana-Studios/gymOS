"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { PAGE_TAKEDOWN_REASON_LABELS, type PageTakedownReason } from "@gymos/types";

import { Button } from "@/components/ui/button";

import { liftPageTakedown, type GymPagePanelData } from "../../../pages/actions";
import { TakedownDialog } from "../../../pages/components/TakedownDialog";
import { SupportActionModal } from "../../../support/components/SupportActionModal";

const TAKEDOWN_STATES: readonly string[] = ["published", "offline_gate", "offline_suspended", "offline_name_released"];

/**
 * SA-03 Page block (Story 24.11): the gym's page name, its state, the takedown reason and appeal state, and the two actions (take down,
 * lift). `data` is null when the state could not be loaded; the rest of the page is unaffected.
 */
export function GymPageBlock({ gymId, data }: { gymId: string; data: GymPagePanelData | null }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const language = i18n.language === "fr" ? "fr" : "en";
  const [takingDown, setTakingDown] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (!data) return <p className="text-sm text-muted-foreground">{t("pages.gym.loadFailed")}</p>;

  const name = data.pageName ?? t("pages.gym.noName");
  const takenDown = data.state === "taken_down";
  const reason = data.reason ? (PAGE_TAKEDOWN_REASON_LABELS[data.reason as PageTakedownReason]?.[language] ?? data.reason) : null;
  // Only a state that has a page row can be taken down (no_page otherwise, after the step-up code was already spent): in_progress and ready have none
  const canTakeDown = TAKEDOWN_STATES.includes(data.state);

  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted-foreground">{t("pages.gym.name")}: </span>
        <span className="font-medium">{name}</span>
      </p>
      <p>
        <span className="text-muted-foreground">{t("pages.gym.state")}: </span>
        <span className="font-medium">{t(`pages.gym.states.${data.state}`)}</span>
      </p>
      {takenDown && reason && <p>{t("pages.gym.reason", { reason })}</p>}
      {takenDown && data.appeal && <p>{t(`pages.gym.appeal.${data.appeal.state}`)}</p>}
      {done && (
        <p role="status" className="text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {takenDown && (
          <Button variant="outline" size="sm" onClick={() => setLifting(true)}>
            {t("pages.takedown.lift")}
          </Button>
        )}
        {canTakeDown && (
          <Button variant="destructive" size="sm" onClick={() => setTakingDown(true)}>
            {t("pages.gym.takeDown")}
          </Button>
        )}
      </div>
      {takingDown && (
        <TakedownDialog
          gymId={gymId}
          pageName={name}
          onDone={() => {
            setDone(t("pages.takedown.done", { name }));
            setTakingDown(false);
            router.refresh();
          }}
          onClose={() => setTakingDown(false)}
        />
      )}
      {lifting && (
        <SupportActionModal
          title={t("pages.takedown.liftTitle", { name })}
          description={t("pages.takedown.liftDescription")}
          submitLabel={t("pages.takedown.liftSubmit")}
          reasonLabel={t("pages.takedown.liftReason")}
          run={(text) => liftPageTakedown({ gymId, reason: text })}
          stepUp={{ action: "lift_gym_page_takedown", subjectId: gymId }}
          onDone={() => {
            setDone(t("pages.takedown.lifted", { name }));
            setLifting(false);
            router.refresh();
          }}
          onClose={() => setLifting(false)}
        />
      )}
    </div>
  );
}
