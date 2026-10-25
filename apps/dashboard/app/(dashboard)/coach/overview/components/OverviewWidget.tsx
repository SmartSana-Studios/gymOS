import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

/**
 * Story 17.5 (AC #10): the frame every AD-20 widget shares -- Story 17.3's My
 * Members At A Glance card, generalised. A presentational server component:
 * it receives translated strings only, never `t`.
 */
export function OverviewWidget({
  title,
  description,
  link,
  children,
}: {
  title: string;
  description?: string;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-md border p-4 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {link && (
          <Button asChild variant="outline" size="sm">
            <Link href={link.href}>
              {link.label}
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
