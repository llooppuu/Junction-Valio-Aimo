import type { Principal } from "../auth.js";
import type { Store } from "../store.js";

export type AuditAction =
  | "quote.created"
  | "quote.refused"
  | "quote.blocked"
  | "permission.checked"
  | "quote.rechecked"
  | "quote.out_of_date"
  | "quote.replaced"
  | "decision.approved"
  | "decision.rejected"
  | "order.placed"
  | "order.refused"
  | "order.replayed"
  | "stock.changed"
  | "stock.alert"
  | "stock.alert_resolved"
  | "substitute.proposed"
  | "standing_order.reviewed"
  | "suggestion.sent"
  | "suggestion.screened"
  | "suggestion.quoted"
  | "suggestion.dismissed"
  | "mandate.issued"
  | "mandate.revoked"
  | "autonomy.changed"
  | "demo.reset"
  | "agent.requested"
  | "agent.finished"
  | "agent.tool_refused"
  | "access.denied";

export interface AuditEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: Readonly<{ id: string; role: string; name: string }>;
  readonly action: AuditAction;
  /** One readable sentence describing what happened. */
  readonly summary: string;
  /** Why it happened, when there is a reason to give. */
  readonly reason?: string;
  readonly quoteId?: string;
  /** A second quote the entry concerns, such as the replacement of a quote. */
  readonly relatedQuoteId?: string;
  readonly orderId?: string;
  readonly productId?: string;
}

export type AuditInput = Omit<AuditEntry, "id" | "at" | "actor">;

/**
 * Appends an entry. Entries are frozen and the API has no route that edits or
 * deletes them, so the history can only grow.
 */
export function recordAudit(store: Store, principal: Principal, input: AuditInput): AuditEntry {
  const entry: AuditEntry = Object.freeze({
    id: `A-${String(store.audit.length + 1).padStart(5, "0")}`,
    at: new Date().toISOString(),
    actor: Object.freeze({ id: principal.id, role: principal.role, name: principal.name }),
    ...input,
  });
  store.audit.push(entry);
  return entry;
}

export function auditForQuote(store: Store, quoteId: string): AuditEntry[] {
  return store.audit.filter((entry) => entry.quoteId === quoteId || entry.relatedQuoteId === quoteId);
}
