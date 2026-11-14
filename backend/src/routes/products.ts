import { Router } from "express";
import { parseOr400, sendError } from "../http.js";
import { productQuerySchema } from "../schemas/product.js";
import { matchesQuery, unmetRequirements, withAvailability } from "../services/catalog.js";
import { DEFAULT_RESULTS, liveProducts, searchLive } from "../services/market.js";
import type { Store } from "../store.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Public, like a webshop's catalog. A search runs over Valio Aimo's static
 * product data first; only the best matches get live price and availability.
 */
export function productsRouter(store: Store) {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = parseOr400(productQuerySchema, req.query, res);
    if (!query) return;
    const live = await searchLive(store, query);
    const matching = live.filter((product) => matchesQuery(product, query)).slice(0, query.limit ?? DEFAULT_RESULTS);
    const requirements = {
      ...(query.deliverBy ? { deliverBy: query.deliverBy } : {}),
      ...(query.excludeAllergens ? { excludeAllergens: query.excludeAllergens } : {}),
    };
    res.json({
      products: matching.map(withAvailability),
      // Matches that fail on live data, with the reason, so an agent knows why they are missing.
      excluded: live
        .filter((product) => !matchesQuery(product, query))
        .map((product) => {
          const reasons = unmetRequirements(product, requirements);
          if (reasons.length === 0 && query.minQuantity !== undefined) reasons.push(`not enough for ${query.minQuantity} ${query.unit ?? ""}`.trim());
          return { productId: product.id, name: product.name, reasons };
        }),
      source: {
        system: "Valio Aimo product data, with the price and availability APIs",
        answeredAt: live[0]?.liveAt ?? null,
        productsQueried: live.length,
      },
    });
  });

  router.get("/:id", async (req, res) => {
    const deliverBy = typeof req.query.deliverBy === "string" && ISO_DATE.test(req.query.deliverBy) ? req.query.deliverBy : undefined;
    const [product] = await liveProducts(store, [String(req.params.id)], deliverBy);
    if (!product) {
      sendError(res, 404, "Product not found");
      return;
    }
    res.json({ product: withAvailability(product) });
  });

  return router;
}
