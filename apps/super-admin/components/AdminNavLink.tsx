"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A nav link that knows whether it is the current destination.
 *
 * Split out as a client component so `(admin)/layout.tsx` stays a server
 * component (it does the `app_role` auth check and server-side translation
 * lookup) -- only the `usePathname()` read needs the client boundary.
 */
export function AdminNavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Prefix match, not equality: /gyms must stay lit on /gyms/[id] (SA-03),
  // the one route in this app with a child segment.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-sm transition-colors",
        active
          ? "font-medium text-foreground underline underline-offset-8 decoration-2"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
