import type { NextFunction, Request, Response } from "express";
import { sendError } from "./http.js";
import { recordAudit } from "./services/audit.js";
import { mandateProblem } from "./services/mandates.js";
import { fiPerson } from "./i18n.js";

const ROLE_FI = { agent: "agentti", buyer: "ostaja", wholesaler: "tukkuri" } as const;
import type { Store } from "./store.js";

export type Role = "agent" | "buyer" | "wholesaler";

export interface Principal {
  id: string;
  role: Role;
  name: string;
  token: string;
}

/**
 * Reads the bearer token and checks the caller has one of the roles. A known
 * caller with the wrong role is recorded in the audit history, because that is
 * an attempt to do something it may not, such as an agent approving its own quote.
 */
export function requireRole(store: Store, ...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const principal = store.principals.find((candidate) => candidate.token === token);

    if (!principal) {
      sendError(res, 401, "Missing or invalid credentials. Send Authorization: Bearer <token>.");
      return;
    }
    if (!roles.includes(principal.role)) {
      recordAudit(store, principal, {
        action: "access.denied",
        summary: `Refused ${req.method} ${req.originalUrl.split("?")[0]} to ${principal.name}.`,
        reason: `This action needs the ${roles.join(" or ")} role, and the caller is ${principal.role === "agent" ? "an agent" : principal.role === "buyer" ? "a buyer" : "the wholesaler"}.`,
        fi: {
          summary: `Pyyntö ${req.method} ${req.originalUrl.split("?")[0]} hylättiin: ${fiPerson(principal.name)}.`,
          reason: `Toiminto vaatii roolin ${roles.map((role) => ROLE_FI[role]).join(" tai ")}, ja kutsuja on ${ROLE_FI[principal.role]}.`,
        },
      });
      sendError(res, 403, `This action needs the ${roles.join(" or ")} role.`);
      return;
    }

    // An agent acts only under the buyer's mandate, checked on every request.
    if (principal.role === "agent") {
      const problem = mandateProblem(store.mandates, principal.id, req.get("x-agent-mandate") ?? undefined, store.buyerIssuer);
      if (problem) {
        recordAudit(store, principal, {
          action: "access.denied",
          summary: `Refused ${req.method} ${req.originalUrl.split("?")[0]} to ${principal.name}: no valid mandate.`,
          reason: `Refused because ${problem}.`,
          fi: {
            summary: `Pyyntö ${req.method} ${req.originalUrl.split("?")[0]} hylättiin: ${fiPerson(principal.name)}, ei voimassa olevaa valtuutusta.`,
            reason: "Agentilla ei ole voimassa olevaa ostajan allekirjoittamaa valtuutusta.",
          },
        });
        sendError(res, 403, `Refused: ${problem}.`, { mandate: true });
        return;
      }
    }

    res.locals.principal = principal;
    next();
  };
}

/** The caller, if a valid bearer token was sent. For public endpoints that adapt to a signed-in agent. */
export function optionalPrincipal(principals: Principal[], req: Request): Principal | undefined {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token ? principals.find((candidate) => candidate.token === token) : undefined;
}

export function currentPrincipal(res: Response): Principal {
  return res.locals.principal as Principal;
}
