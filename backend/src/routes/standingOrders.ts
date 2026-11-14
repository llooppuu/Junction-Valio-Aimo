import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { parseOr400 } from "../http.js";
import { renewStandingOrder, reviewStandingOrder } from "../services/standingOrders.js";
import { nextMonday, plannedOrders } from "../data/plannedOrders.js";
import { helsinkiDate } from "../services/dates.js";
import { liveProducts } from "../services/market.js";
import type { Store } from "../store.js";

export const renewStandingOrderSchema = z.strictObject({
  /** The buyer names the kitchen. An agent always renews its own. */
  agentId: z.string().min(1).optional(),
});

/** Each kitchen's weekly standing order, compared with its recent weeks before it renews. */
export function standingOrdersRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer", "wholesaler"), async (_req, res) => {
    const principal = currentPrincipal(res);
    const agentIds = principal.role === "agent" ? [principal.id] : [...store.policies.keys()];
    await livePlanned(agentIds);
    res.json({ reviews: agentIds.map((agentId) => reviewStandingOrder(store, agentId)) });
  });

  router.post("/renew", requireRole(store, "agent", "buyer"), async (req, res) => {
    const input = parseOr400(renewStandingOrderSchema, req.body ?? {}, res);
    if (!input) return;
    const principal = currentPrincipal(res);
    const agentId = principal.role === "agent" ? principal.id : (input.agentId ?? "demo-agent");
    await livePlanned([agentId]);
    res.status(201).json(renewStandingOrder(store, agentId, principal));
  });

  /** Live price and availability for the kitchens' planned lines, for the next delivery. */
  async function livePlanned(agentIds: string[]) {
    const today = helsinkiDate(store.clock());
    const ids = plannedOrders(today).filter((order) => agentIds.includes(order.agentId)).flatMap((order) => order.lines.map((line) => line.productId));
    await liveProducts(store, ids, nextMonday(today));
  }

  return router;
}
