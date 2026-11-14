import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth.js";
import { parseOr400 } from "../http.js";
import type { Store } from "../store.js";

export const auditQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The whole audit history, newest first. Read-only: there are no write routes. */
export function auditRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "buyer"), (req, res) => {
    const query = parseOr400(auditQuerySchema, req.query, res);
    if (!query) return;
    res.json({ entries: store.audit.slice(-query.limit).reverse(), total: store.audit.length });
  });

  return router;
}
