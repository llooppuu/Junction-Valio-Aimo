import { Router } from "express";
import { z } from "zod";
import { currentPrincipal, requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import { productCategorySchema } from "../schemas/product.js";
import { recordAudit } from "../services/audit.js";
import { formatEur } from "../services/permissions.js";
import { activeMandate, issueMandate, verifyMandate } from "../services/mandates.js";
import { MANDATE_VALID_DAYS, type Store } from "../store.js";

export const issueMandateSchema = z.strictObject({
  agentId: z.string().min(1),
  /** Up to the agent's policy limit. Defaults to it. */
  spendingLimitEurCents: z.number().int().positive().optional(),
  /** Defaults to every category. */
  allowedCategories: z.array(productCategorySchema).min(1).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
});

export const verifyMandateSchema = z.strictObject({ token: z.string().min(1).max(8000) });

/**
 * The buyer's mandates for its agents, as W3C Verifiable Credentials. Only the
 * buyer issues and revokes them; anyone can verify one.
 */
export function mandatesRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer", "wholesaler"), (_req, res) => {
    const principal = currentPrincipal(res);
    res.json({
      issuer: store.buyerIssuer,
      mandates: store.mandates.filter((mandate) => principal.role !== "agent" || mandate.agentId === principal.id).toReversed(),
    });
  });

  router.post("/", requireRole(store, "buyer"), (req, res) => {
    const input = parseOr400(issueMandateSchema, req.body, res);
    if (!input) return;
    const policy = store.policies.get(input.agentId);
    if (!policy) throw new ApiError(404, `Unknown agent "${input.agentId}".`);
    const limit = input.spendingLimitEurCents ?? policy.spendingLimitEurCents;
    if (limit > policy.spendingLimitEurCents) {
      throw new ApiError(422, `A mandate cannot allow more than the agent's policy limit of ${formatEur(policy.spendingLimitEurCents)}.`);
    }
    const previous = activeMandate(store.mandates, input.agentId);
    if (previous) previous.status = "superseded";
    const mandate = issueMandate(
      `M-${String(store.nextMandateNumber++).padStart(4, "0")}`,
      {
        agentId: policy.agentId,
        agentName: policy.agentName,
        buyerName: policy.buyerName,
        spendingLimitEurCents: limit,
        allowedCategories: input.allowedCategories ?? [...productCategorySchema.options],
      },
      input.validDays ?? MANDATE_VALID_DAYS,
    );
    store.mandates.push(mandate);
    recordAudit(store, currentPrincipal(res), {
      action: "mandate.issued",
      summary: `Signed mandate ${mandate.id} for ${policy.agentName}: up to ${formatEur(limit)} per quote, ${mandate.allowedCategories.length} categories, until ${mandate.expiresAt.slice(0, 10)}.`,
      reason: previous ? `Replaces ${previous.id}.` : "The agent had no mandate in force.",
    });
    res.status(201).json({ mandate });
  });

  router.post("/:id/revoke", requireRole(store, "buyer"), (req, res) => {
    const mandate = store.mandates.find((candidate) => candidate.id === String(req.params.id));
    if (!mandate) throw new ApiError(404, `Unknown mandate "${String(req.params.id)}".`);
    if (mandate.status !== "active") throw new ApiError(409, `Mandate ${mandate.id} is already ${mandate.status}.`);
    mandate.status = "revoked";
    mandate.revokedAt = new Date().toISOString();
    recordAudit(store, currentPrincipal(res), {
      action: "mandate.revoked",
      summary: `Revoked mandate ${mandate.id}. ${mandate.agentName} may not act until a new mandate is issued.`,
    });
    res.json({ mandate });
  });

  // Public: anyone, such as a supplier or another agent, can check a mandate.
  router.post("/verify", (req, res) => {
    const input = parseOr400(verifyMandateSchema, req.body, res);
    if (!input) return;
    const check = verifyMandate(input.token);
    const known = store.mandates.find((mandate) => mandate.token === input.token);
    res.json({ ...check, status: known?.status ?? "unknown", issuedByBuyer: check.claims?.iss === store.buyerIssuer });
  });

  return router;
}
