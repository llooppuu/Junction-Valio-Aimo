import { Router } from "express";
import { currentPrincipal, requireRole } from "../auth.js";
import type { Store } from "../store.js";

/** Read-only view of purchasing policies. There is deliberately no way to change them. */
export function policyRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer", "wholesaler"), (_req, res) => {
    const principal = currentPrincipal(res);
    const policies = [...store.policies.values()].filter(
      (policy) => principal.role !== "agent" || policy.agentId === principal.id,
    );
    res.json({ policies });
  });

  return router;
}
