// lib/branch-label.ts
// Turn a set of QMS branch UUIDs (as stored in app_user_branches) into a short,
// human label for display under a user's name. Branch NAMES live in the QMS DB;
// getFilterOptions() is memoized, so calling this repeatedly is cheap.
import { getFilterOptions } from "./analytics/queries";

/** "Westlands", or "Westlands +2 more", or "No branch assigned". */
export async function branchNamesFor(ids: string[]): Promise<string> {
  if (ids.length === 0) return "No branch assigned";
  const { branches } = await getFilterOptions();
  const byId = new Map(branches.map((b) => [b.id, b.name]));
  const names = ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  if (names.length === 0) return `${ids.length} branch${ids.length === 1 ? "" : "es"}`;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1} more`;
}
