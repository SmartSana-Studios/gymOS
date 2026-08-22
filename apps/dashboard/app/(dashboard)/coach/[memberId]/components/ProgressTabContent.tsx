"use client";

import { useTranslation } from "react-i18next";
import { Camera, Minus, Ruler, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { MemberProgressData, ProgressEntryRow } from "@/services/coaches";
import { PhotoGallery } from "./PhotoGallery";
import { SectionHeader } from "./SectionHeader";

const CHART_VIEWBOX_WIDTH = 600;
const CHART_VIEWBOX_HEIGHT = 200;
const CHART_PADDING = 20;

const MEASUREMENT_FIELDS: { key: "waistCm" | "chestCm" | "hipsCm" | "armsCm" | "thighsCm"; labelKey: string }[] = [
  { key: "waistCm", labelKey: "coachPortal.detail.progressTab.measurementLabels.waist" },
  { key: "chestCm", labelKey: "coachPortal.detail.progressTab.measurementLabels.chest" },
  { key: "hipsCm", labelKey: "coachPortal.detail.progressTab.measurementLabels.hips" },
  { key: "armsCm", labelKey: "coachPortal.detail.progressTab.measurementLabels.arms" },
  { key: "thighsCm", labelKey: "coachPortal.detail.progressTab.measurementLabels.thighs" },
];

// Rounds first, then derives sign from the rounded value -- a raw delta like
// -0.04 must not render as the confusing "-0.0" (toFixed(1) alone would
// produce it since -0.04 < 0 but rounds to 0.0).
function formatDelta(delta: number, unit: string): string {
  const rounded = Number(delta.toFixed(1));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} ${unit}`;
}

interface MeasurementRow {
  key: string;
  label: string;
  latest: number;
  delta: number | null;
}

// EXPERIENCE.md:926's "row only if >=2 active entries have a value" rule,
// reused unmodified from Story 10.3's own interpretation of the same rule
// for the member's own screen -- adapted read-only here, no cross-app
// import (AD-7).
function buildMeasurementRows(entries: ProgressEntryRow[], t: (key: string) => string): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  for (const field of MEASUREMENT_FIELDS) {
    const values = entries.map((entry) => entry[field.key]).filter((value): value is number => value != null);
    if (values.length < 2) continue;
    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    rows.push({ key: field.key, label: t(field.labelKey), latest, delta: latest - previous });
  }
  return rows;
}

interface ChartPoint {
  x: number;
  y: number;
  weightKg: number;
  loggedAt: string;
}

// No charting dependency -- plain inline <svg> (Scope Notes). X is evenly
// spaced by index (not calendar-accurate -- acceptable simplification for a
// read-only reference view, no AC calls for calendar spacing). Y linearly
// scaled from [min, max]; a flat/single-value series renders a flat
// horizontal line rather than dividing by zero.
function buildWeightChartPoints(entries: ProgressEntryRow[]): ChartPoint[] {
  const weightEntries = entries.filter(
    (entry): entry is ProgressEntryRow & { weightKg: number } => entry.weightKg != null,
  );
  if (weightEntries.length < 2) return [];

  const weights = weightEntries.map((entry) => entry.weightKg);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const weightSpan = maxWeight - minWeight || 1;
  const innerWidth = CHART_VIEWBOX_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_VIEWBOX_HEIGHT - CHART_PADDING * 2;
  const step = weightEntries.length > 1 ? innerWidth / (weightEntries.length - 1) : 0;

  return weightEntries.map((entry, index) => ({
    x: CHART_PADDING + step * index,
    y:
      minWeight === maxWeight
        ? CHART_PADDING + innerHeight / 2
        : CHART_PADDING + innerHeight - ((entry.weightKg - minWeight) / weightSpan) * innerHeight,
    weightKg: entry.weightKg,
    loggedAt: entry.loggedAt,
  }));
}

function formatChartDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** AD-15 Progress tab (Story 10.4) -- pure presentational, no data fetching.
 * Read-only coach view of a member's weight trend, measurements, and shared
 * photos. Deliberately does not port `apps/mobile`'s goal-directional delta
 * coloring (Scope Notes) -- plain neutral text only. */
export function ProgressTabContent({
  progressData,
  startingWeightKg,
}: {
  progressData: MemberProgressData;
  startingWeightKg: number | null;
}) {
  const { t, i18n } = useTranslation();

  const { entries, sharedPhotos } = progressData;

  if (entries.length === 0 && sharedPhotos.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("coachPortal.detail.progressTab.empty")}
        </CardContent>
      </Card>
    );
  }

  const weightEntries = entries.filter(
    (entry): entry is ProgressEntryRow & { weightKg: number } => entry.weightKg != null,
  );
  const currentWeight = weightEntries.length > 0 ? weightEntries[weightEntries.length - 1].weightKg : null;
  const baselineWeight = startingWeightKg ?? (weightEntries.length > 0 ? weightEntries[0].weightKg : null);
  const deltaKg = currentWeight != null && baselineWeight != null ? currentWeight - baselineWeight : null;
  // Rounds before branching so a delta that rounds to 0.0 (e.g. -0.04) shows
  // the flat state, not a misleading "increase" or "decrease" icon.
  const roundedDeltaKg = deltaKg != null ? Number(deltaKg.toFixed(1)) : null;
  const trendDirection: "up" | "down" | "flat" | null =
    roundedDeltaKg == null ? null : roundedDeltaKg < 0 ? "down" : roundedDeltaKg > 0 ? "up" : "flat";

  const chartPoints = buildWeightChartPoints(entries);
  const measurementRows = buildMeasurementRows(entries, t);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader icon={TrendingUp} accent="blue" title={t("coachPortal.detail.progressTab.weightTrendHeading")} />
        <CardContent className="space-y-4">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t("coachPortal.detail.progressTab.currentWeightLabel")}</p>
              <p className="mt-1 text-3xl font-bold tracking-tight">
                {currentWeight == null
                  ? t("coachPortal.detail.progressTab.noWeightLogged")
                  : t("coachPortal.detail.progressTab.currentWeightOnly", { weight: currentWeight })}
              </p>
            </div>
            {deltaKg != null && (
              // Neutral styling regardless of direction -- a weight
              // increase/decrease is only "good" relative to the member's
              // own goal (lose_weight vs build_muscle), which this read-only
              // coach view deliberately does not encode into color (Scope
              // Notes: no goal-directional delta coloring). The icon shows
              // direction as a fact, not a value judgment.
              <div className="flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {trendDirection === "down" ? (
                  <TrendingDown size={14} />
                ) : trendDirection === "up" ? (
                  <TrendingUp size={14} />
                ) : (
                  <Minus size={14} />
                )}
                {t("coachPortal.detail.progressTab.sinceStartDelta", {
                  delta: formatDelta(deltaKg, t("coachPortal.detail.progressTab.units.kg")),
                })}
              </div>
            )}
          </div>
          {chartPoints.length > 0 ? (
            <div className="relative">
              <svg
                viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}`}
                className="h-48 w-full text-primary"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="weightChartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <polygon
                  points={`${chartPoints[0].x},${CHART_VIEWBOX_HEIGHT - CHART_PADDING} ${chartPoints
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")} ${chartPoints[chartPoints.length - 1].x},${CHART_VIEWBOX_HEIGHT - CHART_PADDING}`}
                  fill="url(#weightChartFill)"
                  stroke="none"
                />
                <polyline
                  points={chartPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {chartPoints.map((point, index) => (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={index === chartPoints.length - 1 ? 5 : 3.5}
                    fill="white"
                    stroke="currentColor"
                    strokeWidth={2}
                  />
                ))}
              </svg>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{formatChartDate(chartPoints[0].loggedAt, i18n.language)}</span>
                <span>{formatChartDate(chartPoints[chartPoints.length - 1].loggedAt, i18n.language)}</span>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("coachPortal.detail.progressTab.chartEmptyState")}
            </p>
          )}
        </CardContent>
      </Card>

      {measurementRows.length > 0 && (
        <Card>
          <SectionHeader icon={Ruler} accent="emerald" title={t("coachPortal.detail.progressTab.measurementsHeading")} />
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {measurementRows.map((row) => (
                <div key={row.key} className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p className="mt-0.5 text-lg font-semibold">
                    {t("coachPortal.detail.progressTab.measurementValue", { value: row.latest })}
                  </p>
                  {row.delta != null && (
                    <p className="text-xs text-muted-foreground">
                      {formatDelta(row.delta, t("coachPortal.detail.progressTab.units.cm"))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {sharedPhotos.length > 0 && (
        <Card>
          <SectionHeader icon={Camera} accent="violet" title={t("coachPortal.detail.progressTab.sharedPhotosHeading")} />
          <CardContent>
            <PhotoGallery photos={sharedPhotos} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
