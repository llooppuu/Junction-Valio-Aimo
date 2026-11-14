import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { describeIssues, sendValidationError } from "../http.js";
import { recordAudit } from "../services/audit.js";
import { getOrder, placeOrder } from "../services/orders.js";
import { liveProducts } from "../services/market.js";
import type { Store } from "../store.js";
import { orderToUbl } from "../services/ubl.js";
import { ApiError } from "../http.js";

export const placeOrderSchema = z.strictObject({
  quoteId: z.string().min(1),
  /** Optional: the quote's signed offer. When given, it must verify and match the quote. */
  offerToken: z.string().min(1).max(4000).optional(),
});

export function ordersRouter(store: Store) {
  const router = Router();
  const anyRole = requireRole(store, "agent", "buyer");

  router.post("/", anyRole, async (req, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      recordAudit(store, currentPrincipal(res), {
        action: "order.refused",
        summary: "Refused an invalid order request.",
        reason: describeIssues(parsed.error),
        fi: { summary: "Virheellinen tilauspyyntö hylättiin.", reason: "Pyynnön tiedot eivät vastanneet rajapinnan kuvausta." },
      });
      sendValidationError(res, parsed.error);
      return;
    }
    const input = parsed.data;
    // The order checks Valio Aimo's price and availability again, just before committing.
    const quote = store.quotes.get(input.quoteId);
    if (quote && !quote.orderId) await liveProducts(store, quote.lines.map((line) => line.productId), quote.deliveryDate);
    const { order, created } = placeOrder(store, input.quoteId, currentPrincipal(res), input.offerToken);
    res.status(created ? 201 : 200).json({ order, created });
  });

  router.get("/", anyRole, (_req, res) => {
    res.json({ orders: [...store.orders.values()].reverse() });
  });

  router.get("/:id", anyRole, (req, res) => {
    res.json({ order: getOrder(store, String(req.params.id)) });
  });

  // The order as a PEPPOL BIS Order 3.0 document, to forward or import. An agent may export only its own kitchen's orders.
  router.get("/:id/ubl", anyRole, (req, res) => {
    const order = getOrder(store, String(req.params.id));
    const principal = currentPrincipal(res);
    if (principal.role === "agent" && store.quotes.get(order.quoteId)?.createdBy.id !== principal.id) {
      throw new ApiError(404, `Order ${order.id} not found.`);
    }
    res.type("application/xml").set("Content-Disposition", `attachment; filename="${order.id}.xml"`).send(orderToUbl(store, order));
  });

  return router;
}
