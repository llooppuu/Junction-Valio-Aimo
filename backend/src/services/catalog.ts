import {
  GS1_ALLERGEN_CODES,
  type Allergen,
  type ContainmentLevel,
  type PackageUnit,
  type Product,
  type ProductQuery,
} from "../schemas/product.js";
import type { Requirements } from "../schemas/quote.js";
import { acceptsUndeclared } from "../data/catalogMapping.js";
import { signClaims, type SignedOffer } from "./signing.js";

export interface Quantity {
  amount: number;
  unit: PackageUnit;
}

/** One GS1 allergen statement, such as { allergenTypeCode: "AM", levelOfContainment: "CONTAINS" }. */
export interface AllergenStatement {
  allergenTypeCode: string;
  levelOfContainment: ContainmentLevel;
  /** The readable name, for people. */
  allergen: Allergen;
}

export type ProductWithAvailability = Product & {
  /** Stock in the product's own unit. Null when Valio Aimo does not limit it or cannot see it. */
  availableQuantity: Quantity | null;
  allergenStatements: AllergenStatement[];
  /** A signed claim on this product's price, stock, origin, and allergens, which any agent can verify. */
  offer: SignedOffer;
};

/** How long a product offer stays valid: long enough to quote, short enough that stock claims stay fresh. */
export const PRODUCT_OFFER_TTL_SECONDS = 15 * 60;

/** Signs what the catalog claims about a product right now, with the time Valio Aimo answered. */
export function signProductOffer(product: Product, now?: Date): SignedOffer {
  return signClaims(
    `product:${product.id}`,
    {
      gtin: product.gtin,
      name: product.name,
      supplier: product.supplier,
      salesUnit: product.salesUnit,
      packageSize: product.packageSize,
      pricePerPackageEurCents: product.pricePerPackageEurCents,
      vatRatePercent: product.vatRatePercent,
      stockStatus: product.stockStatus,
      availablePackages: product.availablePackages,
      deliveryDate: product.deliveryDate,
      orderCutoff: product.orderCutoff,
      origin: product.origin,
      labels: product.labels,
      allergenStatements: allergenStatements(product).map(({ allergenTypeCode, levelOfContainment }) => ({
        allergenTypeCode,
        levelOfContainment,
      })),
      allergensDeclared: product.allergensDeclared,
      source: { system: "Valio Aimo price and availability APIs", answeredAt: product.liveAt },
    },
    PRODUCT_OFFER_TTL_SECONDS,
    now,
  );
}

/** True when stock does not limit an order: Valio Aimo does not report the amount, or the supplier confirms it. */
export const unlimitedStock = (product: Product) => product.stockStatus === "unknown" || product.stockStatus === "unconfirmed";

/** Total stock in the product's own unit, for example 120 cases of 20 L is 2,400 L. */
export function availableQuantity(product: Product): Quantity | null {
  if (unlimitedStock(product) && !product.unavailableReason) return null;
  return {
    amount: Math.round(product.availablePackages * product.packageSize.amount * 1000) / 1000,
    unit: product.packageSize.unit,
  };
}

/** The product's allergens as GS1 statements, derived from one source so the two forms never disagree. */
export function allergenStatements(product: Product): AllergenStatement[] {
  const statement = (allergen: Allergen, levelOfContainment: ContainmentLevel): AllergenStatement => ({
    allergenTypeCode: GS1_ALLERGEN_CODES[allergen],
    levelOfContainment,
    allergen,
  });
  return [
    ...product.allergens.map((allergen) => statement(allergen, "CONTAINS")),
    ...product.mayContain.map((allergen) => statement(allergen, "MAY_CONTAIN")),
    ...product.freeFrom.map((allergen) => statement(allergen, "FREE_FROM")),
  ];
}

export function withAvailability(product: Product): ProductWithAvailability {
  return {
    ...product,
    availableQuantity: availableQuantity(product),
    allergenStatements: allergenStatements(product),
    offer: signProductOffer(product),
  };
}

/** Allergens a product contains or may contain, out of the ones listed. */
export function allergenConflicts(product: Product, excluded: readonly Allergen[]): string[] {
  const reasons: string[] = [];
  for (const allergen of excluded) {
    if (product.allergens.includes(allergen)) reasons.push(`contains ${allergen}`);
    else if (product.mayContain.includes(allergen)) reasons.push(`may contain ${allergen}`);
  }
  return reasons;
}

/**
 * The reason a product cannot be shown to be free of the listed allergens, or
 * undefined. Unprocessed fresh produce without a declaration is accepted.
 */
export function undeclaredAllergens(product: Product, excluded: readonly Allergen[]): string | undefined {
  return excluded.length > 0 && !product.allergensDeclared && !acceptsUndeclared(product.category) ? "allergens not declared by the manufacturer" : undefined;
}

/** Plain-language reasons a product fails the requirements, or an empty list. */
export function unmetRequirements(product: Product, requirements: Requirements): string[] {
  const reasons: string[] = [];
  for (const attribute of requirements.attributes ?? []) {
    if (!product.attributes.includes(attribute)) {
      reasons.push(`not ${attribute}`);
    }
  }
  for (const label of requirements.labels ?? []) {
    if (!product.labels.includes(label)) {
      reasons.push(`no ${label} label`);
    }
  }
  const excluded = requirements.excludeAllergens ?? [];
  reasons.push(...allergenConflicts(product, excluded));
  const undeclared = undeclaredAllergens(product, excluded);
  if (undeclared) reasons.push(undeclared);
  if (product.unavailableReason) reasons.push(product.unavailableReason);
  else if (requirements.deliverBy && product.deliveryDate && product.deliveryDate > requirements.deliverBy) {
    reasons.push(`delivers ${product.deliveryDate}, after the ${requirements.deliverBy} deadline`);
  }
  return reasons;
}

/** The live filters of a search, applied after Valio Aimo has answered. */
export function matchesQuery(product: Product, query: ProductQuery): boolean {
  if (query.category && product.category !== query.category) return false;
  if (query.attributes?.some((attribute) => !product.attributes.includes(attribute))) return false;
  if (query.labels?.some((label) => !product.labels.includes(label))) return false;
  if (query.excludeAllergens && (allergenConflicts(product, query.excludeAllergens).length > 0 || undeclaredAllergens(product, query.excludeAllergens))) {
    return false;
  }
  // ISO dates compare correctly as strings.
  if (query.deliverBy && (!product.deliveryDate || product.unavailableReason || product.deliveryDate > query.deliverBy)) return false;
  if (query.unit && product.packageSize.unit !== query.unit) return false;
  if (query.minQuantity !== undefined) {
    const available = availableQuantity(product);
    if (product.unavailableReason || (available !== null && available.amount < query.minQuantity)) return false;
  }
  return true;
}
