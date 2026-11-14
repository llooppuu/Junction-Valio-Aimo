import type { Principal } from "../auth.js";
import { ApiError } from "../http.js";
import { findProduct, type Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { verifyToken } from "./signing.js";
import { formatEur } from "./permissions.js";
import { findShortfalls, getQuote, markOutOfDate, type QuoteLine, type QuoteStatus } from "./quotes.js";
import { watchStock } from "./stockWatch.js";

export interface Order {
  id: string;
  quoteId: string;
  placedAt: string;
  placedBy: { id: string; role: string; name: string };
  lines: QuoteLine[];
  totalEurCents: number;
  deliveryDate: string;
}

/** Why a quote in each status cannot be ordered. */
const REFUSALS: Partial<Record<QuoteStatus, string>> = {
  needs_approval: "is waiting for the buyer's approval",
  rejected: "was rejected by the buyer",
  out_of_date: "is out of date because stock has changed. Prepare a replacement quote",
};

/**
 * Places an order from an authorized quote. Retrying returns the existing
 * order, because each quote can become at most one order.
 */
export function placeOrder(store: Store, quoteId: string, principal: Principal, offerToken?: string) {
  const quote = getQuote(store, quoteId);

  // An agent may cite the quote's signed offer. If it does, the claim must hold exactly:
  // a tampered, expired, or mismatched offer stops the order, whatever the quote's status.
  if (offerToken !== undefined) {
    const result = verifyToken(offerToken);
    const reason = !result.valid
      ? `the signed offer is not valid: ${result.reason}`
      : result.claims.sub !== `quote:${quote.id}`
        ? `the signed offer is for ${String(result.claims.sub)}, not quote:${quote.id}`
        : result.claims.totalEurCents !== quote.totalEurCents
          ? "the signed offer's total does not match the quote"
          : undefined;
    if (reason) {
      recordAudit(store, principal, {
        action: "order.refused",
        quoteId: quote.id,
        summary: `Refused to order quote ${quote.id}.`,
        reason,
      });
      throw new ApiError(422, `Quote ${quote.id} cannot be ordered: ${reason}.`, { quoteStatus: quote.status });
    }
  }

  // An agent may only order the quotes it created itself; the buyer may order any.
  if (principal.role === "agent" && quote.createdBy.id !== principal.id) {
    const reason = `the quote was created by ${quote.createdBy.name}, and an agent may only order its own quotes`;
    recordAudit(store, principal, {
      action: "order.refused",
      quoteId: quote.id,
      summary: `Refused to order quote ${quote.id}.`,
      reason,
    });
    throw new ApiError(403, `Quote ${quote.id} cannot be ordered: ${reason}.`, { quoteStatus: quote.status });
  }

  if (quote.status === "ordered" && quote.orderId) {
    recordAudit(store, principal, {
      action: "order.replayed",
      quoteId: quote.id,
      orderId: quote.orderId,
      summary: `A repeated order request for quote ${quote.id} returned the existing order ${quote.orderId}.`,
      reason: "Each quote can become at most one order.",
    });
    return { order: store.orders.get(quote.orderId)!, created: false };
  }

  const refuse = (reason: string, extra: object = {}): never => {
    recordAudit(store, principal, {
      action: "order.refused",
      quoteId: quote.id,
      summary: `Refused to order quote ${quote.id}.`,
      reason,
    });
    throw new ApiError(409, `Quote ${quote.id} cannot be ordered: ${reason}.`, { quoteStatus: quote.status, ...extra });
  };

  const refusal = REFUSALS[quote.status];
  if (refusal) refuse(`it ${refusal}`);

  const shortfalls = findShortfalls(store, quote);
  if (shortfalls.length > 0) {
    markOutOfDate(store, quote, shortfalls, principal);
    refuse("stock has changed. Prepare a replacement quote", { shortfalls });
  }

  // Everything is checked, so reserve the stock and record the order in one step.
  for (const line of quote.lines) {
    const product = findProduct(store, line.productId)!;
    if (product.stockStatus === "counted") product.availablePackages -= line.packages;
    store.reservations.set(line.productId, (store.reservations.get(line.productId) ?? 0) + line.packages);
  }
  // An order can use up stock another kitchen relies on, so the stock watch checks every product it touched.
  queueMicrotask(() => {
    for (const line of quote.lines) watchStock(store, line.productId);
  });

  const order: Order = {
    id: `O-${String(store.nextOrderNumber++).padStart(4, "0")}`,
    quoteId: quote.id,
    placedAt: new Date().toISOString(),
    placedBy: { id: principal.id, role: principal.role, name: principal.name },
    lines: quote.lines,
    totalEurCents: quote.totalEurCents,
    deliveryDate: quote.deliveryDate,
  };
  store.orders.set(order.id, order);
  const authorization = quote.status === "approved" ? "approved by the buyer" : "within the agent's limit";
  quote.status = "ordered";
  quote.orderId = order.id;

  recordAudit(store, principal, {
    action: "order.placed",
    quoteId: quote.id,
    orderId: order.id,
    summary: `Placed order ${order.id} for ${formatEur(order.totalEurCents)} from quote ${quote.id}, for delivery by ${order.deliveryDate}.`,
    reason: `The quote was ${authorization}, and stock covered every line.`,
  });

  return { order, created: true };
}

export function getOrder(store: Store, id: string): Order {
  const order = store.orders.get(id);
  if (!order) {
    throw new ApiError(404, `Order ${id} not found.`);
  }
  return order;
}
