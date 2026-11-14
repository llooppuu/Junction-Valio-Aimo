import type { CatalogEntry } from "../data/catalog.js";
import { acceptsUndeclared, productWords, proteinKind, sharedWords } from "../data/catalogMapping.js";
import type { PackageUnit, Product, ProductQuery } from "../schemas/product.js";
import type { Store } from "../store.js";
import { describeTime, nextDeliveryDate } from "./dates.js";
import type { ValioAvailability, ValioPrice } from "./valio.js";

/**
 * Lookup in two steps, as the organizers ask: search Valio Aimo's static
 * product data first, then fetch live price and availability only for the
 * best matches. Products with live data are kept in the store, so the rest of
 * the backend reads them without another call.
 */

const RELATED_CATEGORIES: Partial<Record<CatalogEntry["category"], CatalogEntry["category"][]>> = { milk: ["plant-based"], "plant-based": ["milk"], cream: ["plant-based"] };

/** How many close candidates a quote compares itself with, and a shortfall chooses from. */
export const COMPARABLE_LIMIT = 10;

/** How many products a search returns unless the caller asks for more. */
export const DEFAULT_RESULTS = 20;
export const MAX_RESULTS = 50;
/** Valio Aimo reports these for stock it does not limit or cannot see. */
const UNCONFIRMED_AMOUNT = 999_999;
const PLENTY_THRESHOLD = 1_000_000;
/** An order can never need this many sales units, so plenty or unconfirmed stock never limits one. */
export const UNLIMITED_PACKAGES = 999_999;

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9äöå]+/)
    .filter(Boolean);

/**
 * Search text for one entry: its names and brand, in Finnish and English, and
 * apart from them everything else a buyer might type: supplier, category,
 * attributes, and codes. A word in the name counts more than one elsewhere.
 */
const searchIndex = new WeakMap<CatalogEntry, { names: string; other: string }>();
const textOf = (entry: CatalogEntry) => {
  let text = searchIndex.get(entry);
  if (text === undefined) {
    text = {
      names: ` ${words(`${entry.name} ${entry.nameFi} ${entry.brand ?? ""}`).join(" ")} `,
      other: ` ${words(`${entry.supplier} ${entry.category} ${entry.attributes.join(" ")} ${entry.id} ${entry.gtin ?? ""}`).join(" ")} `,
    };
    searchIndex.set(entry, text);
  }
  return text;
};

/** Allergens an entry contains or may contain out of the listed ones, or "not declared" when the manufacturer said nothing. */
export function entryAllergenConflicts(entry: Pick<CatalogEntry, "allergens" | "mayContain" | "allergensDeclared" | "category">, excluded: readonly string[]): string[] {
  if (excluded.length === 0) return [];
  if (!entry.allergensDeclared) return acceptsUndeclared(entry.category) ? [] : ["allergens not declared by the manufacturer"];
  const reasons: string[] = [];
  for (const allergen of excluded) {
    if ((entry.allergens as string[]).includes(allergen)) reasons.push(`contains ${allergen}`);
    else if ((entry.mayContain as string[]).includes(allergen)) reasons.push(`may contain ${allergen}`);
  }
  return reasons;
}

/**
 * Static matching and relevance. Every word of the text must appear in the
 * product's names, brand, supplier, category, or attributes. A word at the
 * start of a name word counts more than one inside a word.
 */
export function searchCatalog(entries: readonly CatalogEntry[], query: Omit<ProductQuery, "deliverBy" | "minQuantity">, limit = DEFAULT_RESULTS): CatalogEntry[] {
  const terms = query.q ? words(query.q) : [];
  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of entries) {
    if (query.category && entry.category !== query.category) continue;
    if (query.attributes?.some((attribute) => !entry.attributes.includes(attribute))) continue;
    if (query.labels?.some((label) => !entry.labels.includes(label))) continue;
    if (query.excludeAllergens && entryAllergenConflicts(entry, query.excludeAllergens).length > 0) continue;
    if (query.unit && (entry.contents?.unit ?? "piece") !== query.unit) continue;
    let score = 0;
    if (terms.length > 0) {
      const text = textOf(entry);
      let matched = true;
      for (const term of terms) {
        if (text.names.includes(` ${term} `)) score += 6;
        else if (text.names.includes(` ${term}`)) score += 4;
        else if (text.names.includes(term)) score += 2;
        else if (text.other.includes(` ${term}`)) score += 1;
        else {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
    }
    // Products whose contents are known can be ordered by litre or kilogram, and products with a
    // delivery record are ones Valio Aimo actively sells, so both rank first among equals.
    if (entry.contents) score += 0.5;
    if (entry.deliveryReliability !== undefined) score += 1;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, Math.min(limit, MAX_RESULTS)).map((item) => item.entry);
}

const COMPARISON_UNITS: Record<string, "litre" | "kilogram"> = { L: "litre", KG: "kilogram" };
const toCents = (eur: number) => Math.round(eur * 100);

/** What one sales unit contains: from the name when Valio Aimo's price per kg or litre agrees, otherwise from that price. */
function packageSize(entry: CatalogEntry, price: ValioPrice | undefined): Pick<Product, "packageSize" | "packageSizeSource"> {
  const unit = price?.comparisonUnit ? COMPARISON_UNITS[price.comparisonUnit] : undefined;
  const ratio = unit && price?.catalogPrice && price.comparisonPrice?.value ? price.catalogPrice.value / price.comparisonPrice.value : undefined;
  if (entry.contents && (!ratio || (entry.contents.unit === unit && Math.abs(entry.contents.amount - ratio) / ratio < 0.06))) {
    return { packageSize: { amount: entry.contents.amount, unit: entry.contents.unit as PackageUnit }, packageSizeSource: "product name" };
  }
  if (ratio && unit) {
    return { packageSize: { amount: Number(ratio.toPrecision(3)), unit }, packageSizeSource: "comparison price" };
  }
  return { packageSize: { amount: 1, unit: "piece" }, packageSizeSource: "unknown" };
}

/** Builds the product an agent sees from the static entry and Valio Aimo's answer. */
export function toProduct(entry: CatalogEntry, price: ValioPrice | undefined, availability: ValioAvailability | undefined, timeNow: string, now: Date): Product {
  const line = availability?.scheduleLines[0];
  const unit = price?.comparisonUnit ? COMPARISON_UNITS[price.comparisonUnit] : undefined;
  const cutoffPassed = !!availability?.closingTime && Date.parse(availability.closingTime) < now.getTime();

  let availablePackages = 0;
  let stockStatus: Product["stockStatus"] = "none";
  let unavailableReason: string | undefined;
  if (!price || price.error || !price.catalogPrice) unavailableReason = "Valio Aimo has no price for it";
  else if (!availability) unavailableReason = "Valio Aimo did not report its availability";
  else if (availability.salesBlock || line?.salesBlock) unavailableReason = "Valio Aimo has blocked its sales for now";
  else if (!line) unavailableReason = "Valio Aimo cannot deliver it on any date";
  else if (line.availableAmount <= 0) unavailableReason = `none available${line.availableDate ? ` for ${line.availableDate}` : ""}`;
  else if (availability.logisticModel === "Terminal" && line.availableAmount === UNCONFIRMED_AMOUNT) {
    availablePackages = UNLIMITED_PACKAGES;
    stockStatus = "unconfirmed";
  } else if (line.availableAmount >= PLENTY_THRESHOLD) {
    availablePackages = UNLIMITED_PACKAGES;
    stockStatus = "plenty";
  } else {
    availablePackages = Math.floor(line.availableAmount);
    stockStatus = "counted";
  }
  if (!unavailableReason && cutoffPassed && availability?.closingTime) {
    unavailableReason = `the order cut-off for delivery on ${line?.availableDate} was ${describeTime(availability.closingTime)}`;
  }
  // Stock that cannot reach the buyer on its date does not count toward an order.
  if (unavailableReason) availablePackages = 0;

  return {
    id: entry.id,
    ...(entry.gtin ? { gtin: entry.gtin } : {}),
    name: entry.name,
    nameFi: entry.nameFi,
    ...(entry.brand ? { brand: entry.brand } : {}),
    supplier: entry.supplier,
    categoryCode: entry.categoryCode,
    category: entry.category,
    description: entry.description,
    descriptionFi: entry.descriptionFi,
    salesUnit: entry.salesUnit,
    lotSize: entry.lotSize,
    ...packageSize(entry, price),
    pricePerPackageEurCents: price?.catalogPrice ? toCents(price.catalogPrice.value) : 0,
    vatRatePercent: price?.tax?.taxRate ?? 0,
    ...(unit && price?.comparisonPrice ? { comparisonPrice: { eurCents: toCents(price.comparisonPrice.value), unit } } : {}),
    customerPrice: price?.netPriceFound ?? false,
    availablePackages,
    stockStatus,
    deliveryDate: line?.availableDate ?? null,
    orderCutoff: availability?.closingTime ?? null,
    cutoffPassed,
    salesBlock: !!(availability?.salesBlock || line?.salesBlock),
    logisticModel: availability?.logisticModel === "Stock" ? "stock" : availability?.logisticModel === "Terminal" ? "supplier" : "unknown",
    ...(entry.deliveryReliability !== undefined ? { deliveryReliability: entry.deliveryReliability } : {}),
    ...(entry.co2PerKg !== undefined ? { co2PerKg: Math.round(entry.co2PerKg * 100) / 100 } : {}),
    attributes: entry.attributes,
    labels: entry.labels,
    origin: entry.originCountry && /^[A-Z]{2}$/.test(entry.originCountry) ? { country: entry.originCountry } : {},
    ...(entry.temperature ? { temperature: entry.temperature } : {}),
    allergens: entry.allergens,
    mayContain: entry.mayContain,
    freeFrom: entry.freeFrom,
    allergensDeclared: entry.allergensDeclared,
    ...(entry.nutrition ? { nutrition: entry.nutrition } : {}),
    substitutes: entry.substitutes,
    ...(unavailableReason ? { unavailableReason } : {}),
    liveAt: timeNow,
  };
}

/** True when the product can be ordered for delivery on its date right now. */
export const orderable = (product: Product) => !product.unavailableReason;

/**
 * Fetches live price and availability for these products on the requested
 * delivery date, keeps them in the store, and returns them in the same order.
 * Unknown product codes are left out.
 */
export async function liveProducts(store: Store, productIds: readonly string[], requestedDate = nextDeliveryDate(store.clock())): Promise<Product[]> {
  const entries = [...new Set(productIds)].map((id) => store.catalog.byId.get(id)).filter((entry): entry is CatalogEntry => !!entry);
  if (entries.length === 0) return [];
  const answer = await store.valio.lookup(
    entries.map((entry) => entry.id),
    requestedDate,
  );
  const now = store.clock();
  const products = entries.map((entry) => {
    const product = toProduct(entry, answer.prices.get(entry.id), answer.availability.get(entry.id), answer.timeNow, now);
    // Orders placed here are not known to the mock APIs, so they come off the stock Valio Aimo counts.
    const reserved = store.reservations.get(product.id) ?? 0;
    if (product.stockStatus === "counted" && reserved > 0) product.availablePackages = Math.max(0, product.availablePackages - reserved);
    return product;
  });
  for (const product of products) {
    const index = store.products.findIndex((candidate) => candidate.id === product.id);
    if (index >= 0) store.products[index] = product;
    else store.products.push(product);
  }
  return products;
}

/**
 * Searches the static catalog, then fetches live data for the matches. A
 * search with a delivery date or a quantity filters on live data, so it takes
 * the widest set of candidates; the caller trims the results afterwards.
 */
export async function searchLive(store: Store, query: ProductQuery, staticLimit?: number): Promise<Product[]> {
  const liveFilters = query.deliverBy !== undefined || query.minQuantity !== undefined;
  const entries = searchCatalog(store.catalog.entries, query, staticLimit ?? (liveFilters ? MAX_RESULTS : (query.limit ?? DEFAULT_RESULTS)));
  return liveProducts(store, entries.map((entry) => entry.id), query.deliverBy ?? nextDeliveryDate(store.clock()));
}

/** The product a signed offer names, read without verifying it: verification happens when the quote is built. */
export function productIdInOffer(token: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub.startsWith("product:") ? claims.sub.slice("product:".length) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Live data for the products a quote names, and for comparable products in the
 * same categories, so the quote can record what else was considered.
 */
export async function liveForQuote(store: Store, productIds: readonly string[], deliverBy?: string): Promise<void> {
  await liveProducts(store, [...productIds, ...comparableIds(store, productIds)], deliverBy ?? nextDeliveryDate(store.clock()));
}

/** The close candidates for these products: Valio Aimo's substitutes first, then similar names in the same category. */
export function comparableIds(store: Store, productIds: readonly string[]): string[] {
  return [...new Set(productIds.flatMap((id) => substituteCandidates(store, id, COMPARABLE_LIMIT).map((entry) => entry.id)))].filter((id) => !productIds.includes(id));
}

/**
 * Candidates that could replace a product: Valio Aimo's own substitutes first,
 * then products in the same buyer category, best name matches first.
 */
export function substituteCandidates(
  store: Store,
  productId: string,
  limit = 30,
  /** The buyer's rules, applied first so the candidate places go to products that could pass them. */
  rules: { excludeAllergens?: readonly string[]; attributes?: readonly string[]; processed?: boolean } = {},
): CatalogEntry[] {
  const original = store.catalog.byId.get(productId);
  if (!original) return [];
  const listed = original.substitutes.map((id) => store.catalog.byId.get(id)).filter((entry): entry is CatalogEntry => !!entry);
  const nameWords = productWords(original.name, original.brand);
  const kind = proteinKind(original.name);
  // Milk and plant-based alternatives can stand in for each other when the buyer's rules allow it.
  const related = [
    ...(RELATED_CATEGORIES[original.category] ?? []),
    // With a recipe role, a processed product can stand in for a fresh vegetable in a sauce or soup.
    ...(rules.processed && original.category === "vegetables" ? (["pantry", "ready-meals"] as const) : []),
  ];
  const similar = store.catalog.entries
    .filter((entry) => entry.id !== productId && (entry.category === original.category || related.includes(entry.category)) && !original.substitutes.includes(entry.id))
    .filter((entry) => entryAllergenConflicts(entry, rules.excludeAllergens ?? []).length === 0 && (rules.attributes ?? []).every((attribute) => entry.attributes.includes(attribute)))
    .map((entry) => {
      const shared = sharedWords(productWords(entry.name, entry.brand), nameWords).length;
      const sameUnit = entry.contents?.unit === original.contents?.unit ? 1 : 0;
      const attributes = original.attributes.filter((attribute) => entry.attributes.includes(attribute)).length;
      // Products with a delivery record are ones Valio Aimo actively sells, so they are likelier to be available.
      const active = entry.deliveryReliability !== undefined ? 2 : 0;
      const sameKind = kind && proteinKind(entry.name) === kind ? 4 : 0;
      return { entry, score: shared * 3 + attributes + sameUnit + active + sameKind };
    })
    // A candidate shares at least one word of what the product is.
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(0, limit - listed.length))
    .map((item) => item.entry);
  return [...listed, ...similar];
}
