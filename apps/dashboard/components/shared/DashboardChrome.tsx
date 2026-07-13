"use client";

import { Sidebar } from "@/components/shared/Sidebar";
import { TopBar } from "@/components/shared/TopBar";
import type { MemberRole } from "@/services/session";
import { useState } from "react";

/**
 * Owns the mobile-nav-open state shared between TopBar's hamburger toggle
 * and Sidebar's overlay -- a small client-side composition detail, not
 * named explicitly in the story's task list, but required to coordinate
 * the two per EXPERIENCE.md's responsive spec without prop-drilling
 * through the (dashboard) Server Component layout.
 */
export function DashboardChrome({
  role,
  gymName,
  memberName,
  title,
  children,
}: {
  role: MemberRole;
  gymName: string;
  memberName: string;
  title?: string;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={role}
        gymName={gymName}
        memberName={memberName}
        isMobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} title={title} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
