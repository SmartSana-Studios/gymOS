"use client";

import { MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { EMPTY_CELL } from "./constants";

export interface RowAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** A modal that mounts in the same tick the menu closes fights it for focus (Radix focus scopes loop); open it a tick later. */
function deferUntilMenuClosed(fn: () => void) {
  setTimeout(fn, 0);
}

/** The per-row "Actions" dropdown (Members page pattern). Renders a dash when no action is valid for the row. */
export function RowActions({ name, actions, disabled }: { name: string; actions: RowAction[]; disabled?: boolean }) {
  const { t } = useTranslation();
  if (actions.length === 0) return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label={t("support.menu.label", { name })}>
          {t("support.menu.button")}
          <MoreVertical size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a) => (
          <DropdownMenuItem key={a.key} disabled={a.disabled} className={a.destructive ? "text-destructive focus:text-destructive" : undefined} onSelect={() => deferUntilMenuClosed(a.onSelect)}>
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
