import { Router } from "express";
import { parseOr400 } from "../http.js";
import { offersQuerySchema } from "../schemas/product.js";
import { MAX_RESULTS, searchLive } from "../services/market.js";
import { rankOffers } from "../services/offers.js";
import { verifyToken } from "../services/signing.js";
import { z } from "zod";
import type { Store } from "../store.js";

export const verifyOfferSchema = z.strictObject({ token: z.string().min(1).max(4000) });

/** Public, like the catalog: ranked offers with a plain-language reason for each position. */
export function offersRouter(store: Store) {
  const router = Router();

  // Any agent can check a signed offer here, or offline with the key at /.well-known/jwks.json.
  router.post("/verify", (req, res) => {
    const input = parseOr400(verifyOfferSchema, req.body, res);
    if (!input) return;
    res.json(verifyToken(input.token));
  });

  router.get("/", async (req, res) => {
    const query = parseOr400(offersQuerySchema, req.query, res);
    if (!query) return;
    // Ranking needs a wider field than a plain search, so up to 50 candidates get live data.
    const products = await searchLive(store, query, MAX_RESULTS);
    res.json(rankOffers(products, query));
  });

  return router;
}
