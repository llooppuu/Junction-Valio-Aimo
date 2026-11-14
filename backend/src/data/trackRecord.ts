import type { ProductCategory } from "../schemas/product.js";
import type { CategoryRecord, TrackRecords } from "../services/autonomy.js";

/**
 * Each agent's starting track record: the weekly orders the head chef approved
 * over the last eight weeks, before the agent was allowed to act alone. Ours,
 * not Valio Aimo's, like the kitchens' other history.
 *
 * The hotel's weekly categories are earned. Milk is one approval short: the
 * head chef approved two earlier milk orders, so approving the brief's milk
 * request once more lets the agent order milk alone from then on.
 */
const SEED: Record<string, { category: ProductCategory; approvals: number; largestEurCents: number }[]> = {
  "demo-agent": [
    { category: "eggs", approvals: 8, largestEurCents: 6_400 },
    { category: "fats", approvals: 8, largestEurCents: 4_800 },
    { category: "cheese", approvals: 8, largestEurCents: 9_600 },
    { category: "cream", approvals: 8, largestEurCents: 3_600 },
    { category: "vegetables", approvals: 8, largestEurCents: 3_200 },
    { category: "plant-based", approvals: 8, largestEurCents: 5_600 },
    { category: "milk", approvals: 2, largestEurCents: 98_000 },
  ],
  "school-agent": [
    { category: "eggs", approvals: 8, largestEurCents: 3_200 },
    { category: "plant-based", approvals: 8, largestEurCents: 9_800 },
    { category: "pantry", approvals: 8, largestEurCents: 1_500 },
  ],
};

/** A fresh copy of the starting track records. A demo reset restores them. */
export function seededTrackRecords(now: Date = new Date()): TrackRecords {
  const at = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const records: TrackRecords = new Map();
  for (const [agentId, categories] of Object.entries(SEED)) {
    const agent = new Map<ProductCategory, CategoryRecord>();
    for (const { category, approvals, largestEurCents } of categories) {
      agent.set(category, {
        category,
        approvalsInRow: approvals,
        largestApprovedEurCents: largestEurCents,
        totals: { approvals, rejections: 0, refusals: 0 },
        history: [
          {
            at,
            event: "seeded",
            amountEurCents: largestEurCents,
            note: `${approvals} earlier ${category} orders approved by the head chef.`,
          },
        ],
      });
    }
    records.set(agentId, agent);
  }
  return records;
}
