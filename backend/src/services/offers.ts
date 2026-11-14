import type { Label, OffersQuery, PackageUnit, Product, RankBy } from "../schemas/product.js";
import { matchesQuery, withAvailability, type ProductWithAvailability } from "./catalog.js";
import { formatEur } from "./permissions.js";

/**
 * Ranks matching offers on what the buyer cares about and explains each
 * position in plain language, so a buyer or an agent sees the trade-off
 * instead of a bare sort order. Prices are compared per litre, kilogram, or
 * piece, so different package sizes can be compared.
 */

export const LABEL_TEXT: Record<Label, string> = {
  "eu-organic": "EU organic",
  msc: "MSC certified",
  asc: "ASC certified",
  fairtrade: "Fairtrade",
  "rainforest-alliance": "Rainforest Alliance",
  "nordic-swan": "Nordic Swan Ecolabel",
  "eu-ecolabel": "EU Ecolabel",
  krav: "KRAV",
  "finnish-origin": "Finnish origin",
  "heart-symbol": "Heart symbol",
};

const UNIT_TEXT: Record<PackageUnit, string> = { litre: "litre", kilogram: "kg", piece: "piece" };

export interface RankedOffer {
  rank: number;
  product: ProductWithAvailability;
  /** Price per litre, kilogram, or piece, in euro cents. Can have a fraction. */
  unitPriceEurCents: number;
  /** Why the offer is in this position, and what it trades off against the cheapest comparable offer. */
  reason: string;
}

/** A product that matched the search but cannot be ordered for the date, with the reason. */
export interface UnavailableOffer {
  productId: string;
  name: string;
  reason: string;
}

const unitPrice = (product: Product) => product.pricePerPackageEurCents / product.packageSize.amount;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const LAST_DATE = "9999-12-31";
const dateOf = (product: Product) => product.deliveryDate ?? LAST_DATE;

function days(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function dayText(count: number) {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

const dateText = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function preferredCount(product: Product, prefer: Label[]) {
  return prefer.length > 0 ? prefer.filter((label) => product.labels.includes(label)).length : product.labels.length;
}

/** Products without a value rank after those with one. */
const knownFirst = (a: number | undefined, b: number | undefined, direction: 1 | -1) =>
  a === undefined && b === undefined ? 0 : a === undefined ? 1 : b === undefined ? -1 : (a - b) * direction;

const COMPARATORS: Record<RankBy, (prefer: Label[]) => (a: Product, b: Product) => number> = {
  price: () => (a, b) => unitPrice(a) - unitPrice(b) || dateOf(a).localeCompare(dateOf(b)),
  delivery: () => (a, b) => dateOf(a).localeCompare(dateOf(b)) || unitPrice(a) - unitPrice(b),
  reliability: () => (a, b) => knownFirst(a.deliveryReliability, b.deliveryReliability, -1) || unitPrice(a) - unitPrice(b),
  labels: (prefer) => (a, b) => preferredCount(b, prefer) - preferredCount(a, prefer) || unitPrice(a) - unitPrice(b),
  carbon: () => (a, b) => knownFirst(a.co2PerKg, b.co2PerKg, 1) || unitPrice(a) - unitPrice(b),
};

/** What earned the top position, for the offer ranked first. */
function leadFor(product: Product, rankBy: RankBy, prefer: Label[]): string {
  switch (rankBy) {
    case "price":
      return `Lowest price at ${formatEur(unitPrice(product))} per ${UNIT_TEXT[product.packageSize.unit]}`;
    case "delivery":
      return product.deliveryDate ? `Earliest delivery, on ${dateText(product.deliveryDate)}` : "No delivery date";
    case "reliability":
      return product.deliveryReliability !== undefined
        ? `Most reliable delivery: ${percent(product.deliveryReliability)} of ordered quantities delivered as ordered`
        : "No delivery record for any of these products";
    case "labels": {
      const carried = (prefer.length > 0 ? prefer : product.labels).filter((label) => product.labels.includes(label));
      return carried.length > 0 ? `Carries ${list(carried.map((label) => LABEL_TEXT[label]))}` : "No matching labels";
    }
    case "carbon":
      return product.co2PerKg !== undefined
        ? `Lowest carbon footprint, about ${product.co2PerKg} kg CO2e per kg on average for its product group`
        : "No carbon footprint for any of these products";
  }
}

/** The trade-off against the cheapest comparable offer, for example "€0.16 more per litre, but 98% delivered as ordered and EU organic". */
function tradeOff(product: Product, cheapest: Product): string {
  const unit = UNIT_TEXT[product.packageSize.unit];
  const reliability = (item: Product) => (item.deliveryReliability !== undefined ? `${percent(item.deliveryReliability)} delivered as ordered` : undefined);
  if (product.id === cheapest.id) {
    const notes = [reliability(product), ...product.labels.map((label) => LABEL_TEXT[label])].filter((note): note is string => !!note);
    return `The cheapest per ${unit} in these results (${formatEur(unitPrice(product))})${notes.length ? `, with ${list(notes)}` : ""}`;
  }

  const difference = unitPrice(product) - unitPrice(cheapest);
  const price =
    Math.abs(difference) < 0.5
      ? `The same price per ${unit} as ${cheapest.name}`
      : `${formatEur(difference)} more per ${unit} than ${cheapest.name}`;

  const better: string[] = [];
  const worse: string[] = [];
  if (product.deliveryDate && cheapest.deliveryDate) {
    const dayGap = days(cheapest.deliveryDate, product.deliveryDate);
    if (dayGap < 0) better.push(`delivers ${dayText(-dayGap)} sooner`);
    if (dayGap > 0) worse.push(`delivers ${dayText(dayGap)} later`);
  }
  if (product.deliveryReliability !== undefined && cheapest.deliveryReliability !== undefined) {
    const gap = Math.round((product.deliveryReliability - cheapest.deliveryReliability) * 100);
    const text = `${percent(product.deliveryReliability)} delivered as ordered against ${percent(cheapest.deliveryReliability)}`;
    if (gap > 0) better.push(text);
    if (gap < 0) worse.push(text);
  }
  if (product.co2PerKg !== undefined && cheapest.co2PerKg !== undefined && product.co2PerKg !== cheapest.co2PerKg) {
    const text = `about ${product.co2PerKg} kg CO2e per kg against ${cheapest.co2PerKg} (product-group averages)`;
    (product.co2PerKg < cheapest.co2PerKg ? better : worse).push(text);
  }
  const extraLabels = product.labels.filter((label) => !cheapest.labels.includes(label));
  better.push(...extraLabels.map((label) => LABEL_TEXT[label]));
  const missingLabels = cheapest.labels.filter((label) => !product.labels.includes(label));
  worse.push(...missingLabels.map((label) => `not ${LABEL_TEXT[label]}`));

  let sentence = price;
  if (better.length > 0) sentence += `, but ${list(better)}`;
  if (worse.length > 0) sentence += `. Trade-off: ${worse.join(", ")}`;
  return sentence;
}

export function rankOffers(products: Product[], query: OffersQuery): { rankBy: RankBy; offers: RankedOffer[]; unavailable: UnavailableOffer[] } {
  const prefer = query.preferLabels ?? [];
  const unavailable = products
    .filter((product) => product.unavailableReason)
    .map((product) => ({ productId: product.id, name: product.name, reason: product.unavailableReason! }));
  const matching = products.filter((product) => !product.unavailableReason && matchesQuery(product, query));

  // Prices only compare within one unit, so each unit has its own cheapest offer.
  const cheapestByUnit = new Map<PackageUnit, Product>();
  for (const product of matching) {
    const current = cheapestByUnit.get(product.packageSize.unit);
    if (!current || unitPrice(product) < unitPrice(current)) cheapestByUnit.set(product.packageSize.unit, product);
  }

  const sorted = [...matching].sort(COMPARATORS[query.rankBy](prefer));
  const offers = sorted.map((product, index) => {
    const cheapest = cheapestByUnit.get(product.packageSize.unit)!;
    // When ranking by price, the cheapest offer's trade-off sentence already says why it is first.
    const lead = index === 0 && !(query.rankBy === "price" && product.id === cheapest.id);
    const parts = [lead ? leadFor(product, query.rankBy, prefer) : undefined, tradeOff(product, cheapest)];
    return {
      rank: index + 1,
      product: withAvailability(product),
      unitPriceEurCents: unitPrice(product),
      reason: `${parts.filter(Boolean).join(". ")}.`,
    };
  });
  return { rankBy: query.rankBy, offers, unavailable };
}
