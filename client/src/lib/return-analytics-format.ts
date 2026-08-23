/**
 * Formatting and presentation helpers for the Return Analyzer.
 *
 * Every metric on the page is either a percentage, a ratio, or a date, and all
 * of them can legitimately be null when the history is too short to support
 * them. Centralising the "—" rendering keeps a missing value from ever being
 * displayed as a misleading 0.00%.
 */

import type { FlagSeverity, Verdict } from "./return-analytics-types";

export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtSignedPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function fmtRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function fmtMultiple(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return `${value.toFixed(digits)}x`;
}

export function fmtInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtFullDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Green for gains, red for losses, muted for missing — matching the app theme. */
export function toneForValue(value: number | null | undefined, invert = false): string {
  if (value === null || value === undefined || !isFinite(value)) return "text-muted-foreground";
  const positive = invert ? value < 0 : value > 0;
  const negative = invert ? value > 0 : value < 0;
  if (positive) return "text-emerald-500";
  if (negative) return "text-red-500";
  return "text-muted-foreground";
}

/** 0-100 score to a colour band. */
export function toneForScore(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 65) return "text-emerald-400";
  if (score >= 50) return "text-amber-500";
  if (score >= 35) return "text-orange-500";
  return "text-red-500";
}

export function barColorForScore(score: number): string {
  if (score >= 80) return "hsl(152 76% 40%)";
  if (score >= 65) return "hsl(152 60% 45%)";
  if (score >= 50) return "hsl(38 92% 50%)";
  if (score >= 35) return "hsl(25 92% 52%)";
  return "hsl(0 84% 58%)";
}

export function scoreBandLabel(score: number): string {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Adequate";
  if (score >= 35) return "Weak";
  return "Poor";
}

export const VERDICT_STYLES: Record<Verdict, { badge: string; ring: string; icon: string }> = {
  "Strong Recommend": {
    badge: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    ring: "border-emerald-500/40",
    icon: "text-emerald-500",
  },
  Recommend: {
    badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
    ring: "border-emerald-500/30",
    icon: "text-emerald-500",
  },
  "Recommend with Conditions": {
    badge: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    ring: "border-amber-500/40",
    icon: "text-amber-500",
  },
  "Further Diligence Required": {
    badge: "bg-orange-500/15 text-orange-500 border-orange-500/30",
    ring: "border-orange-500/40",
    icon: "text-orange-500",
  },
  "Do Not Recommend": {
    badge: "bg-red-500/15 text-red-500 border-red-500/30",
    ring: "border-red-500/40",
    icon: "text-red-500",
  },
};

export const SEVERITY_STYLES: Record<FlagSeverity, { badge: string; label: string }> = {
  critical: { badge: "bg-red-500/15 text-red-500 border-red-500/30", label: "Critical" },
  high: { badge: "bg-orange-500/15 text-orange-500 border-orange-500/30", label: "High" },
  medium: { badge: "bg-amber-500/15 text-amber-500 border-amber-500/30", label: "Medium" },
  low: { badge: "bg-sky-500/15 text-sky-500 border-sky-500/30", label: "Low" },
};

export const STATUS_STYLES: Record<"pass" | "warn" | "fail", { badge: string; label: string }> = {
  pass: { badge: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", label: "Pass" },
  warn: { badge: "bg-amber-500/15 text-amber-500 border-amber-500/30", label: "Review" },
  fail: { badge: "bg-red-500/15 text-red-500 border-red-500/30", label: "Fail" },
};

/** Series colours, drawn from the app's validated chart tokens. */
export const FUND_COLOR = "hsl(var(--chart-1))";
export const BENCHMARK_COLOR = "hsl(var(--chart-2))";
export const ACCENT_COLOR = "hsl(var(--chart-3))";
export const WARN_COLOR = "hsl(var(--chart-4))";
export const NEGATIVE_COLOR = "hsl(var(--chart-5))";

/** Recharts tooltip chrome, matched to the app's card surface. */
export const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: 12,
} as const;

/** Keeps dense time axes readable without hand-tuning each chart. */
export function axisInterval(pointCount: number): number | "preserveStartEnd" {
  if (pointCount <= 12) return 0;
  if (pointCount <= 240) return Math.max(1, Math.floor(pointCount / 10));
  return "preserveStartEnd";
}

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Escapes a cell for CSV export. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Triggers a client-side file download without a server round trip. */
export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "return-stream";
}
