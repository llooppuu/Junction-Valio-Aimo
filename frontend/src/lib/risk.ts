import type { SupplierReliability } from "./api";
import { tr } from "./i18n";

/**
 * Delivery risk comes from the server's supplier reliability score, so the
 * buyer's app and the agents read the same verdict: low from 95, moderate from
 * 85, high below.
 */
export type DeliveryRisk = SupplierReliability["riskLevel"];

export function riskLabel(risk: DeliveryRisk): string {
  return tr(`risk.${risk}`);
}

/** Each supplier's reliability, keyed by supplier name. */
export function reliabilityBySupplier(suppliers: SupplierReliability[]): Map<string, SupplierReliability> {
  return new Map(suppliers.map((reliability) => [reliability.supplier, reliability]));
}
