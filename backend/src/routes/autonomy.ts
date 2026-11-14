import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import { productCategorySchema } from "../schemas/product.js";
import { agentAutonomy, grantAutonomy, revokeAutonomy } from "../services/autonomy.js";
import { formatEur } from "../services/permissions.js";
import type { Store } from "../store.js";

export const grantAutonomySchema = z.strictObject({
  /** Up to the agent's policy limit. Defaults to it. */
  capEurCents: z.number().int().positive().optional(),
});

export const revokeAutonomySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * Earned autonomy: each agent's track record per product category, and the
 * buyer's controls over it. Agents can read their own record but never change
 * it; only the buyer grants or revokes.
 */
export function autonomyRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer", "wholesaler"), (_req, res) => {
    const principal = currentPrincipal(res);
    const agents = [...store.policies.values()]
      .filter((policy) => principal.role !== "agent" || policy.agentId === principal.id)
      .map((policy) => ({
        agentId: policy.agentId,
        agentName: policy.agentName,
        buyerName: policy.buyerName,
        mode: policy.autonomy.mode,
        approvalsToEarn: policy.autonomy.approvalsToEarn,
        spendingLimitEurCents: policy.spendingLimitEurCents,
        categories: agentAutonomy(store, policy),
      }));
    res.json({ agents });
  });

  function target(agentId: string, category: string) {
    const policy = store.policies.get(agentId);
    if (!policy) throw new ApiError(404, `Unknown agent "${agentId}".`);
    const parsed = productCategorySchema.safeParse(category);
    if (!parsed.success) throw new ApiError(404, `Unknown product category "${category}".`);
    return { policy, category: parsed.data };
  }

  router.post("/:agentId/categories/:category/grant", requireRole(store, "buyer"), (req, res) => {
    const input = parseOr400(grantAutonomySchema, req.body ?? {}, res);
    if (!input) return;
    const { policy, category } = target(String(req.params.agentId), String(req.params.category));
    const cap = input.capEurCents ?? policy.spendingLimitEurCents;
    if (cap > policy.spendingLimitEurCents) {
      throw new ApiError(422, `Autonomy cannot exceed the agent's policy limit of ${formatEur(policy.spendingLimitEurCents)}.`);
    }
    res.json({ category: grantAutonomy(store, currentPrincipal(res), policy, category, cap) });
  });

  router.post("/:agentId/categories/:category/revoke", requireRole(store, "buyer"), (req, res) => {
    const input = parseOr400(revokeAutonomySchema, req.body ?? {}, res);
    if (!input) return;
    const { policy, category } = target(String(req.params.agentId), String(req.params.category));
    res.json({ category: revokeAutonomy(store, currentPrincipal(res), policy, category, input.reason ?? "Revoked by the buyer.") });
  });

  return router;
}
