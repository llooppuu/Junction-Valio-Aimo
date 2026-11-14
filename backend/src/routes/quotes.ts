import { Router } from "express";
import { currentPrincipal, requireRole } from "../auth.js";
import { describeIssues, parseOr400, sendValidationError } from "../http.js";
import { recordAudit } from "../services/audit.js";
import { createQuoteSchema, decisionSchema } from "../schemas/quote.js";
import { createQuote, decideQuote, getQuote, recheckQuote } from "../services/quotes.js";
import { auditForQuote } from "../services/audit.js";
import { shortfallOptions } from "../services/shortfall.js";
import { comparableIds, liveForQuote, liveProducts, productIdInOffer } from "../services/market.js";
import type { Store } from "../store.js";

export function quotesRouter(store: Store) {
  const router = Router();
  const anyRole = requireRole(store, "agent", "buyer");

  router.post("/", anyRole, async (req, res) => {
    const parsed = createQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      // An invalid request can be an attempt to slip in a price or a limit, so it is recorded too.
      recordAudit(store, currentPrincipal(res), {
        action: "quote.refused",
        summary: "Refused an invalid quote request.",
        reason: describeIssues(parsed.error),
      });
      sendValidationError(res, parsed.error);
      return;
    }
    const input = parsed.data;
    const ids = input.lines
      .map((line) => line.productId ?? (line.offerToken ? productIdInOffer(line.offerToken) : undefined))
      .filter((id): id is string => !!id);
    // A replacement keeps the replaced quote's delivery date.
    const deliverBy = input.requirements?.deliverBy ?? (input.replacesQuoteId ? store.quotes.get(input.replacesQuoteId)?.requirements?.deliverBy : undefined);
    await liveForQuote(store, ids, deliverBy);
    res.status(201).json({ quote: createQuote(store, input, currentPrincipal(res)) });
  });

  router.get("/", anyRole, (_req, res) => {
    const quotes = [...store.quotes.values()].reverse();
    res.json({ quotes });
  });

  router.get("/:id", anyRole, (req, res) => {
    res.json({ quote: getQuote(store, String(req.params.id)) });
  });

  router.post("/:id/recheck", anyRole, async (req, res) => {
    await refreshQuote(String(req.params.id));
    res.json(recheckQuote(store, String(req.params.id), currentPrincipal(res)));
  });

  router.get("/:id/audit", anyRole, (req, res) => {
    const quote = getQuote(store, String(req.params.id));
    res.json({ entries: auditForQuote(store, quote.id) });
  });

  router.post("/:id/decision", requireRole(store, "buyer"), async (req, res) => {
    const input = parseOr400(decisionSchema, req.body, res);
    if (!input) return;
    // Approving checks stock again, against Valio Aimo's answer now.
    if (input.decision === "approve") await refreshQuote(String(req.params.id));
    res.json({ quote: decideQuote(store, String(req.params.id), input, currentPrincipal(res)) });
  });

  router.get("/:id/shortfall-options", anyRole, async (req, res) => {
    const quote = getQuote(store, String(req.params.id));
    const ids = (quote.shortfalls ?? []).flatMap((shortfall) => [shortfall.productId, ...comparableIds(store, [shortfall.productId])]);
    await liveProducts(store, ids, quote.requirements?.deliverBy ?? quote.deliveryDate);
    res.json({ plans: shortfallOptions(store, String(req.params.id)) });
  });

  /** Fetches live data for a quote's products on its delivery date, when the quote exists. */
  async function refreshQuote(id: string) {
    const quote = store.quotes.get(id);
    if (quote) await liveProducts(store, quote.lines.map((line) => line.productId), quote.deliveryDate);
  }

  return router;
}
