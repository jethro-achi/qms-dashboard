// lib/ai/tools.ts
// -----------------------------------------------------------------------------
// The assistant's tool surface. Every data tool wraps an EXISTING analytics
// function, so every read passes through buildWhere(filters, principal) — the
// same branch-scoped, fail-closed row-level security the dashboards use. The
// model can never widen scope: the principal is the signed-in caller's, fixed
// server-side. No raw SQL is ever exposed to the model, and only aggregates
// (counts, averages, %) are returned — never customer/ticket rows.
// -----------------------------------------------------------------------------

import { seesAllBranches, type Principal } from "../rbac";
import type { AnalyticsFilters } from "../analytics/filters";
import { getKpis, getTopDrivers, getHourlyTraffic, getFilterOptions } from "../analytics/queries";
import { getBranchOverview } from "../analytics/reports";
import type { ToolSchema } from "./ollama";

const DEFAULT_DAYS = 30;

/** Build validated filters from the model's loose args. `days` bounds the scan;
 *  `branch` narrows by name (RLS still ANDs the caller's allowed branches). */
async function buildFilters(
  args: { days?: unknown; branch?: unknown },
  principal: Principal,
): Promise<AnalyticsFilters> {
  const filters: AnalyticsFilters = {};

  const days = Number(args.days);
  const lookback = Number.isFinite(days) && days > 0 ? Math.min(days, 400) : DEFAULT_DAYS;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - lookback);
  filters.dateFrom = from.toISOString().slice(0, 10);

  const branch = typeof args.branch === "string" ? args.branch.trim().toLowerCase() : "";
  if (branch) {
    const { branches } = await getFilterOptions();
    const match = branches.find((b) => b.name.toLowerCase().includes(branch));
    if (match) filters.branchIds = [match.id];
  }
  return filters;
}

/** Tool definitions advertised to the model (JSON-schema function calling). */
export const AI_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_kpis",
      description:
        "Headline queue metrics: total tickets, served count and %, no-shows, average wait/service/total minutes, SLA %, and average customer rating. Use for 'how many', 'average wait', 'SLA', 'rating' questions.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Look back this many days (default 30)." },
          branch: { type: "string", description: "Optional branch name to filter to." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_services",
      description:
        "The most requested services (by ticket volume). Use for 'busiest service', 'top reasons customers visit', 'what drives traffic'.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Look back this many days (default 30)." },
          branch: { type: "string", description: "Optional branch name to filter to." },
          limit: { type: "integer", description: "How many services to return (default 10)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_busiest_hours",
      description:
        "Ticket volume by hour of day (0–23). Use for 'busiest hour', 'peak time', 'when should we add staff'.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Look back this many days (default 30)." },
          branch: { type: "string", description: "Optional branch name to filter to." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_branch_summary",
      description:
        "Per-branch comparison: total and served tickets, average service minutes, and average wait minutes for each branch the user can see. Use for 'which branch is busiest/slowest', 'compare branches'.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Look back this many days (default 30)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dimensions",
      description:
        "List the branch names and service names available to this user. Call this first if you are unsure of the exact name to filter by.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate a plain arithmetic expression (+, -, *, /, %, parentheses). Use this for any math instead of computing it yourself.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "e.g. \"(1240 - 980) / 1240 * 100\"" },
        },
        required: ["expression"],
      },
    },
  },
];

/** Safe arithmetic only: reject anything that isn't digits/operators/parens so
 *  no identifiers or calls can reach the evaluator. */
function calculate(expression: string): string {
  const expr = String(expression).trim();
  if (!expr || expr.length > 200 || !/^[0-9+\-*/%.()\s]+$/.test(expr)) {
    return JSON.stringify({ error: "Only basic arithmetic (+ - * / % and parentheses) is allowed." });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const value = Function(`"use strict"; return (${expr});`)() as number;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return JSON.stringify({ error: "That expression did not evaluate to a number." });
    }
    return JSON.stringify({ result: Math.round(value * 1000) / 1000 });
  } catch {
    return JSON.stringify({ error: "Could not evaluate that expression." });
  }
}

/**
 * Execute one tool call for a given principal and return a COMPACT JSON string
 * to feed back to the model. Unknown tools and bad args fail soft (they return
 * an error object) so the loop can continue rather than throw.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  principal: Principal,
): Promise<string> {
  try {
    switch (name) {
      case "get_kpis": {
        const kpis = await getKpis(await buildFilters(args, principal), principal);
        return JSON.stringify(kpis);
      }
      case "get_top_services": {
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
        const rows = await getTopDrivers(await buildFilters(args, principal), principal, limit);
        return JSON.stringify(rows);
      }
      case "get_busiest_hours": {
        const hours = await getHourlyTraffic(await buildFilters(args, principal), principal);
        return JSON.stringify(hours.map((h) => ({ hour: h.label, tickets: h.value })));
      }
      case "get_branch_summary": {
        const o = await getBranchOverview(await buildFilters(args, principal), principal);
        return JSON.stringify({
          traffic: o.trafficByBranch,
          avgServiceMin: o.service,
          avgWaitMin: o.wait,
        });
      }
      case "list_dimensions": {
        const { branches, services } = await getFilterOptions();
        const visible = seesAllBranches(principal.role)
          ? branches
          : branches.filter((b) => principal.allowedBranchIds.includes(b.id));
        return JSON.stringify({
          branches: visible.map((b) => b.name),
          services: services.slice(0, 50),
        });
      }
      case "calculate":
        return calculate(String(args.expression ?? ""));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Tool "${name}" failed: ${(err as Error).message}` });
  }
}
