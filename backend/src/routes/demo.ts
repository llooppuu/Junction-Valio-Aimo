import { Router } from "express";
import { abortAgentRuns } from "../agent/runner.js";
import { currentPrincipal, requireRole } from "../auth.js";
import { recordAudit } from "../services/audit.js";
import { resetStore, type Store } from "../store.js";

/**
 * Starting over: clears quotes, orders, alerts, and agent runs. It needs the
 * buyer role. Stock and prices come from Valio Aimo and cannot be set here.
 */
export function demoRouter(store: Store) {
  const router = Router();
  router.use(requireRole(store, "buyer"));

  router.post("/reset", (_req, res) => {
    abortAgentRuns(store.agent);
    resetStore(store);
    recordAudit(store, currentPrincipal(res), {
      action: "demo.reset",
      summary: "Started over: quotes, orders, alerts, suggestions, and agent runs cleared.",
    });
    res.json({ reset: true });
  });

  return router;
}
