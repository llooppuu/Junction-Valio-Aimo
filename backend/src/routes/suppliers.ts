import { Router } from "express";
import { RELIABILITY_FORMULA, supplierReliability } from "../services/reliability.js";
import type { Store } from "../store.js";

/** Public: each supplier's delivery reliability from Valio Aimo's history, with how it is worked out. */
export function suppliersRouter(store: Store) {
  const router = Router();
  const suppliers = supplierReliability(store.catalog.entries);

  router.get("/", (_req, res) => {
    res.json({
      formula: RELIABILITY_FORMULA,
      riskLevels: { low: "95% or more delivered as ordered", moderate: "85% to 95%", high: "below 85%" },
      // The suppliers with the most products on record first: their figure says the most.
      suppliers: [...suppliers].sort((a, b) => b.products - a.products || b.reliability - a.reliability).slice(0, 40),
    });
  });

  return router;
}
