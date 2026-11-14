import { Router } from "express";
import { optionalPrincipal } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import { substitutesQuerySchema } from "../schemas/product.js";
import { liveProducts, substituteCandidates } from "../services/market.js";
import { findSubstitutes } from "../services/substitutes.js";
import type { Store } from "../store.js";

/**
 * Public, like the catalog: good, better, and best substitutes for a request
 * that cannot be fully met. When an agent asks with its token, the server also
 * applies that agent's policy, so it never proposes what the buyer would block
 * or have to approve.
 */
export function substitutesRouter(store: Store) {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = parseOr400(substitutesQuerySchema, req.query, res);
    if (!query) return;
    const { productId, amount, unit, allowNewAllergens, role, ...requirements } = query;
    const caller = optionalPrincipal(store.principals, req);
    const policy = caller?.role === "agent" ? store.policies.get(caller.id) : undefined;
    if (!store.catalog.byId.has(productId)) throw new ApiError(404, `Unknown product "${productId}".`);
    // Valio Aimo's own substitutes and similar products get live data; the rest of the catalog is not queried.
    const excludeAllergens = [...(requirements.excludeAllergens ?? []), ...(policy?.excludedAllergens ?? [])];
    const candidates = substituteCandidates(store, productId, 30, {
      excludeAllergens,
      ...(requirements.attributes ? { attributes: requirements.attributes } : {}),
      processed: role !== undefined,
    }).map((entry) => entry.id);
    const live = await liveProducts(store, [productId, ...candidates], requirements.deliverBy);
    res.json(findSubstitutes(live, { productId, quantity: { amount, unit }, requirements, allowNewAllergens, role }, policy));
  });

  return router;
}
