import { Router } from "express";
import { helsinkiDate } from "../services/dates.js";
import { currentPrincipal, requireRole } from "../auth.js";
import type { AuditAction, AuditEntry } from "../services/audit.js";
import { currentLaunches, runSalesAgent } from "../services/suggestions.js";
import { liveProducts } from "../services/market.js";
import type { Store } from "../store.js";

/** Actions the wholesaler should look at: refusals, blocks, and attempts outside an agent's role. */
const ATTENTION: AuditAction[] = ["quote.blocked", "quote.refused", "order.refused", "access.denied", "agent.tool_refused"];

/**
 * The wholesaler's view: every agent's activity across every buyer, with the
 * quotes waiting for a buyer and the attempts that were refused or blocked.
 * Read-only, and only for the wholesaler role.
 */
export function wholesalerRouter(store: Store) {
  const router = Router();

  // The wholesaler's sales agent: suggests new and seasonal products to every buyer's agent.
  router.post("/suggestions", requireRole(store, "wholesaler"), async (_req, res) => {
    const today = helsinkiDate(store.clock());
    // The sales agent pitches at today's price, so the launches get live data first.
    await liveProducts(store, currentLaunches(today).map((launch) => launch.productId));
    const sent = runSalesAgent(store, currentPrincipal(res), today);
    res.status(201).json({ sent: sent.length, suggestions: sent });
  });

  router.get("/suggestions", requireRole(store, "wholesaler"), (_req, res) => {
    res.json({ suggestions: store.suggestions.toReversed() });
  });

  router.get("/activity", requireRole(store, "wholesaler"), (_req, res) => {
    const quotes = [...store.quotes.values()];
    const orders = [...store.orders.values()];
    const actions = (agentId: string, wanted: AuditAction[]) =>
      store.audit.filter((entry) => entry.actor.id === agentId && wanted.includes(entry.action)).length;

    const agents = [...store.policies.values()].map((policy) => {
      const own = quotes.filter((quote) => quote.createdBy.id === policy.agentId);
      const ownOrders = orders.filter((order) => own.some((quote) => quote.id === order.quoteId));
      return {
        agentId: policy.agentId,
        agentName: policy.agentName,
        buyerName: policy.buyerName,
        quotes: own.length,
        withinLimit: own.filter((quote) => quote.permission.decision === "within_limit").length,
        waitingForApproval: own.filter((quote) => quote.status === "needs_approval").length,
        approved: own.filter((quote) => quote.buyerDecision?.decision === "approve").length,
        rejected: own.filter((quote) => quote.buyerDecision?.decision === "reject").length,
        orders: ownOrders.length,
        orderValueEurCents: ownOrders.reduce((total, order) => total + order.totalEurCents, 0),
        blocked: actions(policy.agentId, ["quote.blocked"]),
        refused: actions(policy.agentId, ["quote.refused", "order.refused"]),
        accessDenied: actions(policy.agentId, ["access.denied"]),
        toolRefused: actions(policy.agentId, ["agent.tool_refused"]),
      };
    });

    const buyerOf = (agentId: string) => store.policies.get(agentId)?.buyerName ?? null;
    const withBuyer = (entry: AuditEntry) => ({ ...entry, buyerName: entry.actor.role === "agent" ? buyerOf(entry.actor.id) : null });

    res.json({
      agents,
      waiting: quotes
        .filter((quote) => quote.status === "needs_approval")
        .map((quote) => ({
          quoteId: quote.id,
          agentName: quote.createdBy.name,
          buyerName: buyerOf(quote.createdBy.id),
          totalEurCents: quote.totalEurCents,
          reason: quote.permission.reason,
          reasonFi: quote.permission.reasonFi,
        })),
      attention: store.audit.filter((entry) => ATTENTION.includes(entry.action)).reverse().map(withBuyer),
      entries: store.audit.slice(-200).reverse().map(withBuyer),
    });
  });

  return router;
}
