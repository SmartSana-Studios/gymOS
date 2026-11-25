"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isActivePath, isGroupActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** A dropdown group of the inline bar. It is lit when the current page is any of its items, and the current item is marked inside the menu. */
export function AdminNavGroup({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const active = isGroupActive(pathname, items);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "font-medium text-foreground underline underline-offset-8 decoration-2" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} aria-current={isActivePath(pathname, item.href) ? "page" : undefined} className={cn(isActivePath(pathname, item.href) && "font-medium")}>
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
