import { Router } from "express";
import { GS1_ALLERGEN_CODES } from "../schemas/product.js";

/** Public reference list: each EU allergen with its GS1 allergen type code. */
export function allergensRouter() {
  const router = Router();
  const allergens = Object.entries(GS1_ALLERGEN_CODES).map(([allergen, gs1Code]) => ({ allergen, gs1Code }));

  router.get("/", (_req, res) => {
    res.json({
      standard: "GS1 AllergenTypeCode",
      levelsOfContainment: ["CONTAINS", "MAY_CONTAIN", "FREE_FROM"],
      allergens,
    });
  });

  return router;
}
