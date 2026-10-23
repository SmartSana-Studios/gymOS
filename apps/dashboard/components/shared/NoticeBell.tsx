"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getStaffNoticesAction, markStaffNoticesReadAction } from "@/app/(dashboard)/actions";
import type { StaffNotice } from "@/services/staff-notices";

const POLL_MS = 60_000;

/**
 * Story 23.9: the in-app notice bell in the dashboard header (Owner). Shows the unread count and the latest notices in the viewer's
 * language. Opening the list marks everything read. The text is written by the database and names no individual.
 */
export function NoticeBell() {
  const { t, i18n } = useTranslation();
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (): Promise<number> => {
    try {
      const { data, error } = await getStaffNoticesAction();
      if (error || !data) {
        setFailed(true);
        return 0;
      }
      setFailed(false);
      setNotices(data.notices);
      setUnread(data.unread);
      return data.unread;
    } catch {
      setFailed(true);
      return 0;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of server data; the state is set after the await
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    const freshUnread = await load();
    if (next && freshUnread > 0) {
      await markStaffNoticesReadAction();
      setUnread(0);
    }
  }

  const fr = i18n.language?.startsWith("fr");
  const label = unread > 0 ? t("notices.bellLabelUnread", { count: unread }) : t("notices.bellLabel");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} className="relative">
          <Bell size={18} />
          {unread > 0 && (
            <span
              data-testid="notice-unread-count"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">{t("notices.title")}</div>
        <ul className="max-h-80 overflow-y-auto">
          {failed && <li className="px-3 py-3 text-sm text-destructive">{t("notices.loadError")}</li>}
          {!failed && notices.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">{t("notices.empty")}</li>}
          {notices.map((n) => (
            <li key={n.id} className="border-b px-3 py-2 last:border-b-0">
              <p className="text-sm font-medium">{fr ? n.titleFr : n.titleEn}</p>
              <p className="text-sm text-muted-foreground">{fr ? n.bodyFr : n.bodyEn}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString(fr ? "fr" : "en")}</p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
