import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { parseOr400 } from "../http.js";
import { refreshStockWatch } from "../services/stockWatch.js";
import type { Store } from "../store.js";

export const alertsQuerySchema = z.strictObject({
  /** Only open or only resolved alerts. Both by default. */
  status: z.enum(["open", "resolved"]).optional(),
});

/**
 * Stock alerts raised by the agents' stock watch, newest first. An agent sees
 * only its own kitchen's; the buyer and the wholesaler see all of them.
 */
export function alertsRouter(store: Store) {
  const router = Router();
  router.get("/", requireRole(store, "agent", "buyer", "wholesaler"), async (req, res) => {
    const query = parseOr400(alertsQuerySchema, req.query, res);
    if (!query) return;
    // The watch asks Valio Aimo about what the kitchens depend on. Answers are cached briefly, so this stays cheap.
    await refreshStockWatch(store);
    const principal = currentPrincipal(res);
    res.json({
      alerts: store.alerts
        .filter((alert) => (principal.role !== "agent" || alert.agentId === principal.id) && (!query.status || alert.status === query.status))
        .toReversed(),
    });
  });
  return router;
}
