import { launches, type Launch } from "../data/launches.js";
import type { Principal } from "../auth.js";
import { ApiError } from "../http.js";
import type { Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { guardrailChecks, type GuardrailCheck } from "./permissions.js";
import { createQuote, type Quote } from "./quotes.js";
import { fiBuyer } from "../i18n.js";

const KIND_FI = { new: "uutuus", seasonal: "sesonkituote" } as const;

/**
 * Proactive selling, in two halves. The wholesaler's sales agent spots new and
 * seasonal products and suggests them to every buyer's agent. Each buyer's
 * agent screens the suggestion against its own buyer's policy on the server,
 * passes only suitable ones to the buyer with a reason, and holds back the
 * rest, also with a reason. A suggestion can become a quote, but that quote
 * always waits for the buyer: the wholesaler never orders on a buyer's behalf.
 */

export interface Suggestion {
  id: string;
  at: string;
  /** Always the wholesaler: this marks the suggestion as wholesaler-initiated. */
  from: { id: string; role: string; name: string };
  agentId: string;
  buyerName: string;
  productId: string;
  productName: string;
  supplier: string;
  kind: Launch["kind"];
  pitch: string;
  pricePerPackageEurCents: number;
  /** suggested: passed to the buyer; held_back: the buyer's agent screened it out. */
  status: "suggested" | "held_back" | "quoted" | "dismissed";
  screening: { suitable: boolean; reason: string; reasonFi: string; checks: GuardrailCheck[] };
  quoteId?: string;
}

function seasonOf(date: string) {
  const month = Number(date.slice(5, 7));
  return month >= 3 && month <= 5 ? "spring" : month >= 6 && month <= 8 ? "summer" : month >= 9 && month <= 11 ? "autumn" : "winter";
}

const DAYS = 24 * 60 * 60 * 1000;

/** What the sales agent may promote today: launched in the last 60 days, or in season. */
export function currentLaunches(today: string): Launch[] {
  return launches.filter((launch) =>
    launch.kind === "new"
      ? Date.parse(today) - Date.parse(launch.since) <= 60 * DAYS && launch.since <= today
      : (launch.seasons ?? []).includes(seasonOf(today)),
  );
}

/** Runs the sales agent: one suggestion per current launch for every buyer's agent, each screened at once. */
export function runSalesAgent(store: Store, wholesaler: Principal, today: string): Suggestion[] {
  const sent: Suggestion[] = [];
  for (const launch of currentLaunches(today)) {
    const product = store.products.find((candidate) => candidate.id === launch.productId);
    if (!product) continue;
    for (const policy of store.policies.values()) {
      // Each product is suggested to a kitchen once, so the buyer is not nagged.
      if (store.suggestions.some((existing) => existing.agentId === policy.agentId && existing.productId === product.id)) continue;
      const agent = store.principals.find((principal) => principal.id === policy.agentId);
      if (!agent) continue;

      const checks = guardrailChecks(policy, [product], product.pricePerPackageEurCents).filter((check) => check.rule !== "spending_limit");
      const failing = checks.filter((check) => check.outcome !== "passed");
      const suitable = failing.length === 0;
      const reason = suitable
        ? `Meets every rule of ${policy.buyerName}: ${checks.map((check) => check.detail).join("; ")}.`
        : `Held back: ${failing.map((check) => check.detail).join("; ")}.`;
      const reasonFi = suitable
        ? `Täyttää kaikki ostajan ${fiBuyer(policy.buyerName)} säännöt: ${checks.map((check) => check.detailFi).join("; ")}.`
        : `Pidätetty: ${failing.map((check) => check.detailFi).join("; ")}.`;

      const suggestion: Suggestion = {
        id: `S-${String(store.nextSuggestionNumber++).padStart(4, "0")}`,
        at: store.clock().toISOString(),
        from: { id: wholesaler.id, role: wholesaler.role, name: wholesaler.name },
        agentId: policy.agentId,
        buyerName: policy.buyerName,
        productId: product.id,
        productName: product.name,
        supplier: product.supplier,
        kind: launch.kind,
        pitch: launch.pitch,
        pricePerPackageEurCents: product.pricePerPackageEurCents,
        status: suitable ? "suggested" : "held_back",
        screening: { suitable, reason, reasonFi, checks },
      };
      store.suggestions.push(suggestion);
      sent.push(suggestion);

      recordAudit(store, wholesaler, {
        action: "suggestion.sent",
        productId: product.id,
        summary: `${suggestion.id}: the wholesaler's sales agent suggested ${product.name} (${launch.kind}) to ${policy.buyerName}.`,
        reason: "Wholesaler-initiated. Nothing is ordered unless the buyer approves.",
        fi: {
          summary: `${suggestion.id}: tukkurin myyntiagentti ehdotti tuotetta ${product.nameFi} (${KIND_FI[launch.kind]}) ostajalle ${fiBuyer(policy.buyerName)}.`,
          reason: "Tukkurin aloitteesta. Mitään ei tilata, ellei ostaja hyväksy.",
        },
      });
      recordAudit(store, agent, {
        action: "suggestion.screened",
        productId: product.id,
        summary: `${suggestion.id}: ${suitable ? "passed to the buyer" : "held back from the buyer"} after checking ${policy.buyerName}'s policy.`,
        reason,
        fi: {
          summary: `${suggestion.id}: ${suitable ? "välitettiin ostajalle" : "pidätettiin ostajalta"} ostajan ${fiBuyer(policy.buyerName)} sääntöjen tarkistuksen jälkeen.`,
          reason: reasonFi,
        },
      });
    }
  }
  return sent;
}

function suggestionFor(store: Store, id: string, principal: Principal): Suggestion {
  const suggestion = store.suggestions.find((candidate) => candidate.id === id);
  if (!suggestion || (principal.role === "agent" && suggestion.agentId !== principal.id)) {
    throw new ApiError(404, `Unknown suggestion "${id}".`);
  }
  return suggestion;
}

/**
 * Turns a suggestion into a quote. The quote always needs the buyer's
 * approval when an agent makes it, however small, because the idea came from
 * the seller, not the buyer.
 */
export function quoteSuggestion(store: Store, id: string, packages: number, principal: Principal): Quote {
  const suggestion = suggestionFor(store, id, principal);
  if (suggestion.status === "held_back") {
    throw new ApiError(409, `Suggestion ${id} was held back: ${suggestion.screening.reason}`);
  }
  if (suggestion.status === "dismissed") throw new ApiError(409, `Suggestion ${id} was dismissed by the buyer.`);
  const owner = principal.role === "agent" ? principal : store.principals.find((candidate) => candidate.id === suggestion.agentId)!;
  const quote = createQuote(
    store,
    { lines: [{ productId: suggestion.productId, quantity: { amount: packages, unit: "package" } }] },
    principal.role === "buyer" ? principal : owner,
    {
      extraChecks: [
        {
          rule: "wholesaler_suggestion",
          outcome: "needs_approval",
          detail: `suggested by the wholesaler's sales agent (${suggestion.id}), so the buyer decides`,
          detailFi: `tukkurin myyntiagentin ehdotus (${suggestion.id}), joten ostaja päättää`,
        },
      ],
      suggestionId: suggestion.id,
    },
  );
  suggestion.status = "quoted";
  suggestion.quoteId = quote.id;
  recordAudit(store, principal, {
    action: "suggestion.quoted",
    quoteId: quote.id,
    productId: suggestion.productId,
    summary: `${suggestion.id} became quote ${quote.id}. It waits for the buyer, because the wholesaler suggested it.`,
    fi: { summary: `Ehdotuksesta ${suggestion.id} tehtiin tarjous ${quote.id}. Se odottaa ostajaa, koska ehdotus tuli tukkurilta.` },
  });
  return quote;
}

export function dismissSuggestion(store: Store, id: string, principal: Principal): Suggestion {
  const suggestion = suggestionFor(store, id, principal);
  suggestion.status = "dismissed";
  recordAudit(store, principal, {
    action: "suggestion.dismissed",
    productId: suggestion.productId,
    summary: `${suggestion.id}: the buyer dismissed the suggestion of ${suggestion.productName}.`,
    fi: { summary: `${suggestion.id}: ostaja hylkäsi ehdotuksen.` },
  });
  return suggestion;
}
