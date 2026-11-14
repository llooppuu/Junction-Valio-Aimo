import type { Principal } from "../auth.js";
import { ApiError } from "../http.js";
import type { Product } from "../schemas/product.js";
import type { CreateQuoteInput, RequestedQuantity, Requirements } from "../schemas/quote.js";
import { findProduct, type Store } from "../store.js";
import { unmetRequirements, type Quantity } from "./catalog.js";
import { signClaims, verifyToken, type SignedOffer } from "./signing.js";
import type { StandingOrderReview } from "./standingOrders.js";
import { consideredAlternatives, type Alternative } from "./alternatives.js";
import type { MenuPlan } from "./menuPlan.js";
import { recordAudit } from "./audit.js";
import { comparableIds } from "./market.js";
import {
  checkPermission,
  formatEur,
  type PermissionCheck,
  type PermissionDecision,
  type GuardrailCheck,
} from "./permissions.js";

export type QuoteStatus =
  | "within_limit"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "out_of_date"
  | "ordered";

export interface BuyerDecision {
  decision: "approve" | "reject";
  by: { id: string; name: string };
  at: string;
  note?: string;
}

const STATUS_FOR_DECISION: Record<PermissionDecision, QuoteStatus> = {
  within_limit: "within_limit",
  needs_approval: "needs_approval",
  created_by_buyer: "approved",
};

/** A quote line that current stock can no longer fill. */
export interface Shortfall {
  productId: string;
  supplier: string;
  packagesNeeded: number;
  availablePackages: number;
  missingPackages: number;
  missingQuantity: Quantity;
}

export interface QuoteLine {
  productId: string;
  productName: string;
  supplier: string;
  /** What the client asked for, in its own unit. */
  requested: RequestedQuantity;
  /** Whole packages needed to cover the request. */
  packages: number;
  /** What the packages contain, which can be slightly more than requested. */
  quantity: Quantity;
  /** Valio Aimo's price for one sales unit without VAT when the quote was made. The quote holds it fixed. */
  pricePerPackageEurCents: number;
  lineTotalEurCents: number;
  /** The unit Valio Aimo sells it in, such as KI (case). */
  salesUnit: string;
  vatRatePercent: number;
  /** True when the price was the buyer's own net price. */
  customerPrice: boolean;
  deliveryDate: string;
  /** Order by this time to receive it on deliveryDate. */
  orderCutoff: string | null;
  /** Counted, plenty, or unconfirmed because the supplier delivers from its own warehouse. */
  stockStatus: Product["stockStatus"];
}

export interface Quote {
  id: string;
  /** A signed claim on this quote's lines and total, which an agent can verify and cite when ordering. */
  offer?: SignedOffer;
  /** Every comparable product when the quote was made: chosen, not chosen, or excluded, with the reason. */
  alternatives?: Alternative[];
  /** The menu calculation this quote orders, when it came from a plan. */
  plan?: MenuPlan;
  /** For a standing order renewal: the comparison with recent weeks. */
  standingOrder?: StandingOrderReview;
  /** The wholesaler's suggestion this quote came from, if any. */
  suggestionId?: string;
  status: QuoteStatus;
  createdAt: string;
  createdBy: { id: string; role: string; name: string };
  lines: QuoteLine[];
  totalEurCents: number;
  /** The server's decision on whether the creator may order this quote alone. */
  permission: PermissionCheck;
  /** The latest delivery date across all lines. */
  deliveryDate: string;
  /** Set when a stock recheck finds the quote can no longer be filled. */
  shortfalls?: Shortfall[];
  /** What every line must satisfy. Carried over to a replacement quote. */
  requirements?: Requirements;
  /** The out-of-date quote this one replaces. */
  replacesQuoteId?: string;
  /** The quote that replaced this one. */
  replacedBy?: string;
  /** The buyer's decision on a quote that needed approval. */
  buyerDecision?: BuyerDecision;
  /** The order placed from this quote. */
  orderId?: string;
}

const UNIT_LABELS = { litre: "L", kilogram: "kg", piece: "pcs" } as const;

export function describeQuantity({ amount, unit }: Quantity): string {
  return `${amount.toLocaleString("en-GB")} ${UNIT_LABELS[unit]}`;
}

/** Converts a requested quantity to whole packages, rounding up. */
export function packagesNeeded(product: Product, requested: RequestedQuantity): number {
  if (requested.unit === "package") {
    if (!Number.isInteger(requested.amount)) {
      throw new ApiError(422, `Package quantities must be whole numbers, got ${requested.amount}.`);
    }
    return requested.amount;
  }

  if (requested.unit !== product.packageSize.unit) {
    throw new ApiError(
      422,
      `${product.id} is sold by the ${product.packageSize.unit}, so it cannot be ordered in ${requested.unit}s. Use "${product.packageSize.unit}" or "package".`,
    );
  }

  // The small tolerance stops floating-point noise from adding an extra package.
  const packages = Math.ceil(requested.amount / product.packageSize.amount - 1e-9);
  // Valio Aimo sells some products only in multiples of a lot size.
  return Math.ceil(packages / product.lotSize - 1e-9) * product.lotSize;
}

export function buildLine(product: Product, requested: RequestedQuantity): QuoteLine {
  const packages = packagesNeeded(product, requested);

  if (product.unavailableReason || !product.deliveryDate) {
    throw new ApiError(409, `${product.name} (${product.id}) cannot be quoted: ${product.unavailableReason ?? "Valio Aimo gives no delivery date"}.`, {
      productId: product.id,
      reason: product.unavailableReason,
    });
  }

  if (packages > product.availablePackages) {
    const available = { amount: product.availablePackages * product.packageSize.amount, unit: product.packageSize.unit };
    throw new ApiError(
      409,
      `Not enough stock for ${product.id}: ${packages} packages needed, ${product.availablePackages} available (${describeQuantity(available)}).`,
      { productId: product.id, packagesNeeded: packages, availablePackages: product.availablePackages },
    );
  }

  return {
    productId: product.id,
    productName: product.name,
    supplier: product.supplier,
    requested,
    packages,
    quantity: { amount: packages * product.packageSize.amount, unit: product.packageSize.unit },
    pricePerPackageEurCents: product.pricePerPackageEurCents,
    lineTotalEurCents: packages * product.pricePerPackageEurCents,
    salesUnit: product.salesUnit,
    vatRatePercent: product.vatRatePercent,
    customerPrice: product.customerPrice,
    deliveryDate: product.deliveryDate,
    orderCutoff: product.orderCutoff,
    stockStatus: product.stockStatus,
  };
}

/** Builds a quote at fixed catalog prices. Clients never supply prices. Refusals are audited. */
/** Server-side additions that no client can set, such as the drift check on a renewal. */
export interface QuoteOptions {
  extraChecks?: GuardrailCheck[];
  standingOrder?: StandingOrderReview;
  suggestionId?: string;
}

export function createQuote(store: Store, input: CreateQuoteInput, principal: Principal, options: QuoteOptions = {}): Quote {
  try {
    return buildQuote(store, input, principal, options);
  } catch (error) {
    if (error instanceof ApiError) {
      const blocked = (error.extra as { blocked?: boolean }).blocked === true;
      recordAudit(store, principal, {
        action: blocked ? "quote.blocked" : "quote.refused",
        summary: `${blocked ? "Blocked" : "Refused"} a quote for ${input.lines.map((line) => line.productId).join(", ")}.`,
        reason: error.message,
        ...(input.replacesQuoteId ? { relatedQuoteId: input.replacesQuoteId } : {}),
      });
    }
    throw error;
  }
}

function describeLines(lines: QuoteLine[]): string {
  return lines
    .map((line) => `${line.packages} packages (${describeQuantity(line.quantity)}) from ${line.supplier}`)
    .join(" and ");
}

function buildQuote(store: Store, input: CreateQuoteInput, principal: Principal, options: QuoteOptions): Quote {
  const replaced = input.replacesQuoteId ? replaceableQuote(store, input.replacesQuoteId) : undefined;
  const plan = input.planId ? store.plans.get(input.planId) : undefined;
  if (input.planId && (!plan || (principal.role === "agent" && plan.agentId !== principal.id))) {
    throw new ApiError(404, `Unknown menu plan "${input.planId}".`);
  }
  const requirements = input.requirements ?? replaced?.requirements;

  const products: Product[] = [];
  const lines = input.lines.map((line) => {
    const productId = line.offerToken ? productFromOffer(store, line.offerToken) : line.productId!;
    const quantity = line.quantity;
    const product = findProduct(store, productId);
    if (!product) {
      throw new ApiError(422, `Unknown product "${productId}".`, { productId });
    }
    const unmet = requirements ? unmetRequirements(product, requirements) : [];
    if (unmet.length > 0) {
      throw new ApiError(422, `${product.id} does not meet the quote's requirements: ${unmet.join("; ")}.`, {
        productId,
        unmet,
      });
    }
    products.push(product);
    return buildLine(product, quantity);
  });

  const totalEurCents = lines.reduce((sum, line) => sum + line.lineTotalEurCents, 0);
  // Checked before the quote is numbered, so a refused or blocked quote takes no number.
  const permission = checkPermission(store, principal, products, totalEurCents, options.extraChecks);

  const quote: Quote = {
    id: `Q-${String(store.nextQuoteNumber++).padStart(4, "0")}`,
    status: STATUS_FOR_DECISION[permission.decision],
    createdAt: new Date().toISOString(),
    createdBy: { id: principal.id, role: principal.role, name: principal.name },
    lines,
    totalEurCents,
    permission,
    deliveryDate: lines.map((line) => line.deliveryDate).sort().at(-1)!,
    ...(requirements ? { requirements } : {}),
    ...(replaced ? { replacesQuoteId: replaced.id } : {}),
    ...(plan ? { plan: structuredClone(plan) } : {}),
    ...(options.standingOrder ? { standingOrder: options.standingOrder } : {}),
    ...(options.suggestionId ? { suggestionId: options.suggestionId } : {}),
  };

  quote.offer = signQuoteOffer(quote);
  // Only close candidates are compared, so the record shows real alternatives rather than the whole category.
  const comparable = new Set([...lines.map((line) => line.productId), ...comparableIds(store, lines.map((line) => line.productId))]);
  quote.alternatives = consideredAlternatives(
    store.products.filter((product) => comparable.has(product.id)),
    lines,
    requirements,
    principal.role === "agent" ? store.policies.get(principal.id) : undefined,
  );
  if (replaced) replaced.replacedBy = quote.id;
  store.quotes.set(quote.id, quote);

  recordAudit(store, principal, {
    action: "quote.created",
    quoteId: quote.id,
    summary: `Created quote ${quote.id} for ${formatEur(quote.totalEurCents)}: ${describeLines(lines)}.`,
    ...(requirements ? { reason: `Requirements: ${describeRequirements(requirements)}.` } : {}),
  });
  if (replaced) {
    recordAudit(store, principal, {
      action: "quote.replaced",
      quoteId: replaced.id,
      relatedQuoteId: quote.id,
      summary: `Quote ${replaced.id} was replaced by ${quote.id}.`,
      reason:
        replaced.status === "rejected"
          ? "The buyer rejected the original quote, so the agent prepared an alternative."
          : "The original quote was out of date because stock had changed.",
    });
  }
  recordAudit(store, principal, {
    action: "permission.checked",
    quoteId: quote.id,
    summary: PERMISSION_SUMMARIES[permission.decision](quote.id),
    reason: permission.reason,
  });
  return quote;
}

const PERMISSION_SUMMARIES: Record<PermissionDecision, (id: string) => string> = {
  within_limit: (id) => `Quote ${id} is within the agent's limit.`,
  needs_approval: (id) => `Quote ${id} needs the buyer's approval.`,
  created_by_buyer: (id) => `Quote ${id} was created by the buyer.`,
};

function describeRequirements({ attributes, deliverBy }: Requirements): string {
  return [
    ...(attributes?.length ? [attributes.join(", ")] : []),
    ...(deliverBy ? [`delivered by ${deliverBy}`] : []),
  ].join(", ");
}

/** Marks a quote out of date and records why. */
export function markOutOfDate(store: Store, quote: Quote, shortfalls: Shortfall[], principal: Principal) {
  quote.status = "out_of_date";
  quote.shortfalls = shortfalls;
  recordAudit(store, principal, {
    action: "quote.out_of_date",
    quoteId: quote.id,
    summary: `Quote ${quote.id} is out of date.`,
    reason: shortfalls
      .map((item) => `${describeQuantity(item.missingQuantity)} missing from ${item.supplier} (${item.availablePackages} of ${item.packagesNeeded} packages left)`)
      .join("; "),
  });
}

/** Only an out-of-date quote that has not been replaced yet can be replaced. */
/**
 * A quote can be replaced when it can no longer be ordered as it is: stock
 * changed, or the buyer rejected it and wants an alternative. The new quote
 * gets its own permission check, so a replacement never inherits an approval.
 */
function replaceableQuote(store: Store, id: string): Quote {
  const quote = getQuote(store, id);
  if (quote.status !== "out_of_date" && quote.status !== "rejected") {
    throw new ApiError(
      409,
      `Quote ${id} is ${quote.status}. Only an out-of-date or rejected quote can be replaced. For a new need, create a quote without replacesQuoteId.`,
    );
  }
  if (quote.replacedBy) {
    throw new ApiError(409, `Quote ${id} was already replaced by ${quote.replacedBy}.`);
  }
  return quote;
}

/** Compares each line with current stock. */
export function findShortfalls(store: Store, quote: Quote): Shortfall[] {
  return quote.lines.flatMap((line) => {
    const product = findProduct(store, line.productId);
    const availablePackages = product?.availablePackages ?? 0;
    if (line.packages <= availablePackages) return [];

    const missingPackages = line.packages - availablePackages;
    const packageAmount = line.quantity.amount / line.packages;
    return [
      {
        productId: line.productId,
        supplier: line.supplier,
        packagesNeeded: line.packages,
        availablePackages,
        missingPackages,
        missingQuantity: { amount: missingPackages * packageAmount, unit: line.quantity.unit },
      },
    ];
  });
}

/** Statuses whose quote could still become an order, so a recheck makes sense. */
const RECHECKABLE: ReadonlySet<QuoteStatus> = new Set([
  "within_limit",
  "needs_approval",
  "approved",
  "out_of_date",
]);

/**
 * Rechecks a quote against current stock. A quote that can no longer be
 * filled becomes out_of_date and stays that way: it must be replaced.
 */
export function recheckQuote(store: Store, id: string, principal: Principal) {
  const quote = getQuote(store, id);
  if (!RECHECKABLE.has(quote.status)) {
    throw new ApiError(409, `Quote ${id} is ${quote.status} and cannot be rechecked.`);
  }

  const shortfalls = findShortfalls(store, quote);
  const changed = shortfalls.length > 0 && quote.status !== "out_of_date";
  if (changed) {
    markOutOfDate(store, quote, shortfalls, principal);
  } else {
    recordAudit(store, principal, {
      action: "quote.rechecked",
      quoteId: quote.id,
      summary:
        quote.status === "out_of_date"
          ? `Rechecked quote ${quote.id}: it is still out of date.`
          : `Rechecked quote ${quote.id}: stock still covers every line.`,
    });
  }

  return { quote, changed, shortfalls };
}

/**
 * Records the buyer's decision on one exact quote. Quotes never change after
 * creation, so an approval cannot carry over to different lines or totals.
 */
export function decideQuote(
  store: Store,
  id: string,
  input: { decision: "approve" | "reject"; note?: string | undefined },
  principal: Principal,
) {
  const quote = getQuote(store, id);
  if (quote.status !== "needs_approval") {
    throw new ApiError(409, `Quote ${id} is ${quote.status}. Only a quote that needs approval can be decided.`);
  }

  // Approving something stock can no longer fill would only fail later at ordering.
  if (input.decision === "approve") {
    const shortfalls = findShortfalls(store, quote);
    if (shortfalls.length > 0) {
      markOutOfDate(store, quote, shortfalls, principal);
      throw new ApiError(409, `Quote ${id} is out of date because stock has changed. Prepare a replacement.`, {
        shortfalls,
      });
    }
  }

  quote.status = input.decision === "approve" ? "approved" : "rejected";
  quote.buyerDecision = {
    decision: input.decision,
    by: { id: principal.id, name: principal.name },
    at: new Date().toISOString(),
    ...(input.note ? { note: input.note } : {}),
  };
  recordAudit(store, principal, {
    action: input.decision === "approve" ? "decision.approved" : "decision.rejected",
    quoteId: quote.id,
    summary: `${input.decision === "approve" ? "Approved" : "Rejected"} quote ${quote.id} for ${formatEur(quote.totalEurCents)}.`,
    ...(input.note ? { reason: input.note } : {}),
  });
  return quote;
}

export function getQuote(store: Store, id: string): Quote {
  const quote = store.quotes.get(id);
  if (!quote) {
    throw new ApiError(404, `Quote ${id} not found.`);
  }
  return quote;
}

/** A quote's signed claim stays valid for a day, long enough for a buyer to approve it. */
export const QUOTE_OFFER_TTL_SECONDS = 24 * 60 * 60;

export function signQuoteOffer(quote: Quote, now?: Date): SignedOffer {
  return signClaims(
    `quote:${quote.id}`,
    {
      lines: quote.lines.map((line) => ({
        productId: line.productId,
        packages: line.packages,
        pricePerPackageEurCents: line.pricePerPackageEurCents,
        lineTotalEurCents: line.lineTotalEurCents,
      })),
      totalEurCents: quote.totalEurCents,
      deliveryDate: quote.deliveryDate,
    },
    QUOTE_OFFER_TTL_SECONDS,
    now,
  );
}

/**
 * Resolves a signed product offer to its product. The offer must verify, and
 * its price must still be the catalog price, so an agent never quotes from a
 * claim we no longer stand behind.
 */
function productFromOffer(store: Store, token: string): string {
  const result = verifyToken(token);
  if (!result.valid) {
    throw new ApiError(422, `The product offer is not valid: ${result.reason}. Fetch a fresh offer from GET /api/products.`);
  }
  const productId = String(result.claims.sub).replace(/^product:/, "");
  const product = findProduct(store, productId);
  if (!product || !String(result.claims.sub).startsWith("product:")) {
    throw new ApiError(422, "The offer does not name a product in the catalog.");
  }
  if (result.claims.pricePerPackageEurCents !== product.pricePerPackageEurCents) {
    throw new ApiError(409, `The price of ${product.id} changed after the offer was issued. Fetch a fresh offer.`, {
      productId: product.id,
    });
  }
  return product.id;
}
