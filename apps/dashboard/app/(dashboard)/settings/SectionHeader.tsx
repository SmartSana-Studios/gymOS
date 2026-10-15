import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

// Tinted per-section icon treatment (each section gets its own accent so the
// grid reads as distinct categories at a glance, rather than one repeated
// muted-gray icon) -- deliberately independent of the gym's own configurable
// `primaryColor` brand color below, since these are fixed UI chrome, not
// tenant-branded surface.
export const SECTION_ACCENTS = {
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
} as const;

export function SectionHeader({
  icon: Icon,
  accent,
  title,
  description,
}: {
  icon: LucideIcon;
  accent: keyof typeof SECTION_ACCENTS;
  title: string;
  description: string;
}) {
  return (
    <CardHeader className="flex-row items-center gap-3 space-y-0">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${SECTION_ACCENTS[accent]}`}>
        <Icon className="size-4.5" aria-hidden="true" />
      </div>
      <div className="space-y-0.5">
        <CardTitle role="heading" aria-level={2} className="text-base">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </CardHeader>
  );
}
