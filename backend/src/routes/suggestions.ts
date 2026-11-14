import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { parseOr400 } from "../http.js";
import { dismissSuggestion, quoteSuggestion } from "../services/suggestions.js";
import { liveProducts } from "../services/market.js";
import type { Store } from "../store.js";

export const suggestionsQuerySchema = z.strictObject({
  status: z.enum(["suggested", "held_back", "quoted", "dismissed"]).optional(),
});

export const quoteSuggestionSchema = z.strictObject({
  /** Whole packages to quote. One by default. */
  packages: z.number().int().positive().max(1000).optional(),
});

/** The wholesaler's suggestions as each buyer's agent screened them. An agent sees only its own kitchen's. */
export function suggestionsRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer"), (req, res) => {
    const query = parseOr400(suggestionsQuerySchema, req.query, res);
    if (!query) return;
    const principal = currentPrincipal(res);
    res.json({
      suggestions: store.suggestions
        .filter((suggestion) => (principal.role !== "agent" || suggestion.agentId === principal.id) && (!query.status || suggestion.status === query.status))
        .toReversed(),
    });
  });

  router.post("/:id/quote", requireRole(store, "agent", "buyer"), async (req, res) => {
    const input = parseOr400(quoteSuggestionSchema, req.body ?? {}, res);
    if (!input) return;
    const suggestion = store.suggestions.find((candidate) => candidate.id === String(req.params.id));
    if (suggestion) await liveProducts(store, [suggestion.productId]);
    res.status(201).json({ quote: quoteSuggestion(store, String(req.params.id), input.packages ?? 1, currentPrincipal(res)) });
  });

  router.post("/:id/dismiss", requireRole(store, "buyer"), (req, res) => {
    res.json({ suggestion: dismissSuggestion(store, String(req.params.id), currentPrincipal(res)) });
  });

  return router;
}
