import type { CatalogEntry } from "../data/catalog.js";

/**
 * Delivery reliability from Valio Aimo's history: the share of ordered
 * quantities that were delivered as ordered, per product, from 0 to 1. Not
 * every product has a value. A supplier's figure is the average over its
 * products that have one.
 */
export const RELIABILITY_FORMULA =
  "Share of ordered quantities delivered as ordered, from Valio Aimo's delivery history (1 = everything delivered as ordered). A supplier's figure is the average over its products with a record.";

export type RiskLevel = "low" | "moderate" | "high";

/** Low from 95%, moderate from 85%, high below. */
export function riskLevel(reliability: number): RiskLevel {
  return reliability >= 0.95 ? "low" : reliability >= 0.85 ? "moderate" : "high";
}

export interface SupplierReliability {
  supplier: string;
  /** Products of this supplier with a delivery record. */
  products: number;
  /** Average share delivered as ordered, 0 to 1. */
  reliability: number;
  /** The supplier's least reliable product. */
  lowest: { productId: string; name: string; reliability: number };
  riskLevel: RiskLevel;
  /** True when the supplier is not low risk, so buyers and agents should plan for it. */
  flagged: boolean;
}

/** Each food supplier's reliability, from the products in the catalog that have a record. */
export function supplierReliability(entries: readonly CatalogEntry[]): SupplierReliability[] {
  const bySupplier = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    // Kitchens buy food here, so napkins and cleaning products do not count toward a supplier's figure.
    if (entry.deliveryReliability === undefined || entry.category === "non-food" || entry.category === "other") continue;
    const list = bySupplier.get(entry.supplier) ?? [];
    list.push(entry);
    bySupplier.set(entry.supplier, list);
  }
  return [...bySupplier].map(([supplier, products]) => {
    const reliability = Math.round((products.reduce((sum, entry) => sum + entry.deliveryReliability!, 0) / products.length) * 1000) / 1000;
    const lowest = products.reduce((worst, entry) => (entry.deliveryReliability! < worst.deliveryReliability! ? entry : worst));
    const level = riskLevel(reliability);
    return {
      supplier,
      products: products.length,
      reliability,
      lowest: { productId: lowest.id, name: lowest.name, reliability: lowest.deliveryReliability! },
      riskLevel: level,
      flagged: level !== "low",
    };
  });
}
