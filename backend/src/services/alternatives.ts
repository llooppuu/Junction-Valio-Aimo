import type { PackageUnit, Product } from "../schemas/product.js";
import type { Requirements } from "../schemas/quote.js";
import { unmetRequirements } from "./catalog.js";
import { formatEur, type AgentPolicy } from "./permissions.js";
import { policyReasons } from "./substitutes.js";

/**
 * The alternatives behind a quote: every comparable product in the same
 * categories, marked chosen, not chosen, or excluded, with the reason. It is a
 * snapshot taken when the quote is created, so the buyer and the wholesaler can
 * later see what the agent could have chosen instead, and why it did not.
 */
export interface Alternative {
  productId: string;
  productName: string;
  supplier: string;
  verdict: "chosen" | "not_chosen" | "excluded";
  reason: string;
}

interface ChosenLine {
  productId: string;
  packages: number;
  quantity: { amount: number; unit: PackageUnit };
}

const UNIT_WORDS: Record<PackageUnit, string> = { litre: "litre", kilogram: "kg", piece: "piece" };
const UNIT_SHORT: Record<PackageUnit, string> = { litre: "L", kilogram: "kg", piece: "pcs" };
const unitPrice = (product: Product) => product.pricePerPackageEurCents / product.packageSize.amount;
const dateText = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function consideredAlternatives(
  catalog: Product[],
  lines: ChosenLine[],
  requirements: Requirements | undefined,
  policy: AgentPolicy | undefined,
): Alternative[] {
  const chosen = lines.map((line) => ({ line, product: catalog.find((product) => product.id === line.productId)! }));
  const alternatives: Alternative[] = chosen.map(({ line, product }) => ({
    productId: product.id,
    productName: product.name,
    supplier: product.supplier,
    verdict: "chosen",
    reason: `Chosen: ${line.packages} packages (${line.quantity.amount.toLocaleString("en-GB")} ${UNIT_SHORT[line.quantity.unit]}) at ${formatEur(unitPrice(product))} per ${UNIT_WORDS[product.packageSize.unit]}, delivering ${product.deliveryDate ? dateText(product.deliveryDate) : "on a date Valio Aimo has not given"}`,
  }));

  for (const candidate of catalog) {
    if (chosen.some(({ product }) => product.id === candidate.id)) continue;
    // Comparable means the same category and unit as a chosen line.
    const comparable = chosen.filter(
      ({ product }) => product.category === candidate.category && product.packageSize.unit === candidate.packageSize.unit,
    );
    if (comparable.length === 0) continue;

    const base = { productId: candidate.id, productName: candidate.name, supplier: candidate.supplier };
    // Availability counts even without requirements: a product Valio Aimo cannot deliver says why.
    const unmet = unmetRequirements(candidate, requirements ?? {});
    // The buyer's policy can repeat a requirement the quote already states, such as lactose-free; say it once.
    const fromPolicy = (policy ? policyReasons(policy, candidate) : []).filter(
      (reason) => !unmet.some((requirement) => reason.startsWith(requirement.replace(/^not /, "is not ")) || reason.startsWith(requirement)),
    );
    const excluded = [...unmet, ...fromPolicy];
    if (excluded.length > 0) {
      alternatives.push({ ...base, verdict: "excluded", reason: `Excluded: ${excluded.join("; ")}` });
      continue;
    }

    const unit = candidate.packageSize.unit;
    const total = comparable.reduce((sum, { line }) => sum + line.quantity.amount, 0);
    const smallest = Math.min(...comparable.map(({ line }) => line.quantity.amount));
    const stock = candidate.availablePackages * candidate.packageSize.amount;
    // The dearest chosen product in this category is the marginal choice a candidate had to beat.
    const marginal = comparable.reduce((dearest, entry) => (unitPrice(entry.product) > unitPrice(dearest.product) ? entry : dearest));
    const difference = unitPrice(candidate) - unitPrice(marginal.product);
    const reliability = (product: Product) => (product.deliveryReliability !== undefined ? `${Math.round(product.deliveryReliability * 100)}%` : undefined);
    const priceText =
      Math.abs(difference) < 0.5
        ? `the same price per ${UNIT_WORDS[unit]} as ${marginal.product.name}`
        : `${formatEur(Math.abs(difference))} ${difference > 0 ? "more" : "less"} per ${UNIT_WORDS[unit]} than ${marginal.product.name}`;

    let reason: string;
    if (stock >= total) {
      reason = `Not chosen: meets every requirement and could cover all ${total.toLocaleString("en-GB")} ${UNIT_SHORT[unit]}, but ${priceText}`;
    } else if (stock >= smallest && comparable.length > 1) {
      reason = `Not chosen: could cover the ${smallest.toLocaleString("en-GB")} ${UNIT_SHORT[unit]} part, but ${priceText}`;
    } else {
      const needed = Math.ceil(total / candidate.packageSize.amount - 1e-9);
      reason = `Not chosen: only ${candidate.availablePackages} packages (${stock.toLocaleString("en-GB")} ${UNIT_SHORT[unit]}) in stock, ${needed} needed for ${total.toLocaleString("en-GB")} ${UNIT_SHORT[unit]}`;
    }
    // A cheaper alternative that was passed over says why it might still have been reasonable.
    if (difference < 0 && reliability(candidate) !== undefined && reliability(marginal.product) !== undefined) {
      reason += ` (delivered as ordered ${reliability(candidate)} of the time against ${reliability(marginal.product)})`;
    }
    alternatives.push({ ...base, verdict: "not_chosen", reason });
  }
  return alternatives;
}
