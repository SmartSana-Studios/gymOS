import type { LucideIcon } from "lucide-react";

import { CardHeader, CardTitle } from "@/components/ui/card";

// Tinted per-section icon treatment, mirroring Settings' own SectionHeader
// pattern (apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx) so this
// route reads consistently with the rest of the dashboard -- same accent
// palette, same size-9 rounded-lg badge shape. Route-local rather than
// promoted to components/ui/, matching that Settings' own version is itself
// still an unexported, page-local component, not a shared primitive.
const SECTION_ACCENTS = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
} as const;

export function SectionHeader({
  icon: Icon,
  accent,
  title,
  action,
}: {
  icon: LucideIcon;
  accent: keyof typeof SECTION_ACCENTS;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <CardHeader className="flex flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${SECTION_ACCENTS[accent]}`}>
          <Icon className="size-4.5" aria-hidden="true" />
        </div>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {title}
        </CardTitle>
      </div>
      {action}
    </CardHeader>
  );
}
