// lib/analytics/breakdown-shared.ts
// -----------------------------------------------------------------------------
// Client-safe constants + types for the per-visual drill-down.
//
// Kept deliberately FREE of any server/DB imports so a "use client" component
// (drilldown-bar-card.tsx) can import these without dragging the database layer
// (mysql2 / mssql-tedious → node:tls/net/dns) into the browser bundle. The
// server-only aggregation logic lives in ./breakdown, which re-exports this file
// so existing server imports keep working unchanged.
// -----------------------------------------------------------------------------

export type BreakdownMetric =
  | "traffic" | "served" | "noShows" | "avgWait" | "avgService" | "slaPct" | "avgRating";
export type BreakdownDimension = "branch" | "service" | "queue" | "agent" | "status";

export const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
  branch: "Branch", service: "Service", queue: "Queue", agent: "Agent", status: "Status",
};

// The order the drill-down offers dimensions and auto-advances through them.
export const DRILL_ORDER: readonly BreakdownDimension[] = ["branch", "service", "agent", "queue", "status"];

export interface BreakdownRow { key: string; label: string; value: number }
export interface DrillStep { dimension: BreakdownDimension; key: string }

// Whether a higher value is the desirable direction (for the caller's colouring).
export const METRIC_HIGHER_BETTER: Record<BreakdownMetric, boolean> = {
  traffic: true, served: true, noShows: false, avgWait: false, avgService: false, slaPct: true, avgRating: true,
};
