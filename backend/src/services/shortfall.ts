import { ApiError } from "../http.js";
import type { Product } from "../schemas/product.js";
import { findProduct, type Store } from "../store.js";
import { unmetRequirements, type Quantity } from "./catalog.js";
import { getQuote, type Quote, type Shortfall } from "./quotes.js";
import { comparableIds } from "./market.js";

export interface ShortfallOption {
  productId: string;
  productName: string;
  supplier: string;
  packages: number;
  quantity: Quantity;
  costEurCents: number;
  deliveryDate: string;
}

export interface ExcludedProduct {
  productId: string;
  supplier: string;
  reasons: string[];
}

export interface ShortfallPlan {
  shortfall: Shortfall;
  /** The part of the original line that current stock can still fill. */
  keep: { productId: string; packages: number } | null;
  /** Products that can cover the missing quantity, cheapest first. */
  options: ShortfallOption[];
  /** Products in the same category that cannot, and why. */
  excluded: ExcludedProduct[];
}

/** Packages of a product that the quote's remaining lines still plan to use. */
function plannedPackages(quote: Quote, productId: string, shortfalls: Shortfall[]): number {
  const line = quote.lines.find((candidate) => candidate.productId === productId);
  if (!line) return 0;
  const shortfall = shortfalls.find((candidate) => candidate.productId === productId);
  return shortfall ? shortfall.availablePackages : line.packages;
}

function planFor(store: Store, quote: Quote, shortfall: Shortfall, shortfalls: Shortfall[]): ShortfallPlan {
  const original = findProduct(store, shortfall.productId)!;
  // Without an explicit deadline, a replacement must not arrive later than the original plan.
  const requirements = {
    ...quote.requirements,
    deliverBy: quote.requirements?.deliverBy ?? original.deliveryDate ?? quote.deliveryDate,
  };

  const options: ShortfallOption[] = [];
  const excluded: ExcludedProduct[] = [];
  // The product itself, for its remaining stock, and its close candidates: not everything in the category.
  const close = new Set([original.id, ...comparableIds(store, [original.id])]);
  const candidates = store.products.filter(
    (product: Product) => close.has(product.id) && product.packageSize.unit === original.packageSize.unit,
  );

  for (const product of candidates) {
    const packages = Math.ceil(shortfall.missingQuantity.amount / product.packageSize.amount - 1e-9);
    const free = product.availablePackages - plannedPackages(quote, product.id, shortfalls);
    const reasons = unmetRequirements(product, requirements);
    if (free < packages) {
      reasons.push(
        free <= 0
          ? "no stock left after what the quote already uses"
          : `only ${free} packages free, ${packages} needed`,
      );
    }

    if (reasons.length > 0) {
      excluded.push({ productId: product.id, supplier: product.supplier, reasons });
      continue;
    }
    options.push({
      productId: product.id,
      productName: product.name,
      supplier: product.supplier,
      packages,
      quantity: { amount: packages * product.packageSize.amount, unit: product.packageSize.unit },
      costEurCents: packages * product.pricePerPackageEurCents,
      deliveryDate: product.deliveryDate ?? requirements.deliverBy,
    });
  }

  options.sort((a, b) => a.costEurCents - b.costEurCents || a.deliveryDate.localeCompare(b.deliveryDate));
  return {
    shortfall,
    keep: shortfall.availablePackages > 0
      ? { productId: shortfall.productId, packages: shortfall.availablePackages }
      : null,
    options,
    excluded,
  };
}

/** Ranked ways to cover each shortfall of an out-of-date quote. */
export function shortfallOptions(store: Store, id: string): ShortfallPlan[] {
  const quote = getQuote(store, id);
  if (quote.status !== "out_of_date" || !quote.shortfalls) {
    throw new ApiError(409, `Quote ${id} has no shortfall. Recheck it first.`);
  }
  return quote.shortfalls.map((shortfall) => planFor(store, quote, shortfall, quote.shortfalls!));
}
