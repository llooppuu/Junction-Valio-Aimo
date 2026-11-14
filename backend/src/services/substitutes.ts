import { ApiError } from "../http.js";
import { formWords, productWords, proteinKind, sharedWords } from "../data/catalogMapping.js";
import { productCategorySchema } from "../schemas/product.js";
import type { Allergen, IngredientRole, PackageUnit, Product, ProductCategory } from "../schemas/product.js";
import type { Requirements } from "../schemas/quote.js";
import { unmetRequirements, type Quantity } from "./catalog.js";
import { LABEL_TEXT } from "./offers.js";
import { ALLERGEN_FI, fiEur, fiList, LABEL_FI, requirementFi } from "../i18n.js";
import { formatEur, guardrailChecks, type AgentPolicy } from "./permissions.js";

/**
 * Good, better, and best substitutes for a request the catalog cannot fully
 * meet. Every substitute meets the buyer's rules; anything that breaks a
 * required attribute, label, allergen rule, or deadline is excluded with its
 * reason and never proposed.
 */

export type Tier = "best" | "better" | "good";

export interface SubstituteRequest {
  productId: string;
  quantity: { amount: number; unit: PackageUnit | "package" };
  requirements: Requirements;
  /**
   * By default a substitute may not add an allergen the requested product does
   * not contain, because that would quietly change the allergen declaration of
   * the dish it goes into. Set this only when the buyer has accepted that.
   */
  allowNewAllergens?: boolean;
  /** The ingredient's role in a recipe, which decides whether a processed product can stand in. */
  role?: IngredientRole | undefined;
}

/** Roles where a processed product can replace a fresh one: a sauce or soup cooks it down anyway. */
const PROCESSED_OK = new Set<IngredientRole>(["sauce base", "soup base"]);
/** Roles where the product is seen as it is, so it must stay fresh. */
const FRESH_ONLY = new Set<IngredientRole>(["salad garnish", "salad topping"]);

export interface Substitute {
  tier: Tier;
  productId: string;
  productName: string;
  supplier: string;
  packages: number;
  quantity: Quantity;
  costEurCents: number;
  deliveryDate: string | null;
  /** 0 to 100: how closely it matches the requested product. */
  matchScore: number;
  /** What makes it a close match, for example "same category" or "similar product: tomatoes". */
  matchNotes: string[];
  /** The trade-off against the requested product in price, delivery, and labels. */
  tradeOff: string;
  /** The trade-off in Finnish. */
  tradeOffFi: string;
  /** Each part of the ranking, 0 to 100, and their weighted total, which sets the tier. */
  scores: SubstituteScores;
  /** Why each part scored as it did, in plain language. */
  scoreNotes: { price: string; preference: string; availability: string };
}

export interface SubstituteScores {
  /** How closely it matches the requested product: category, name, attributes, and nutrition. */
  similarity: number;
  /** Full marks when it costs the same or less than the requested product. */
  price: number;
  /** Whether it keeps the requested product's supplier and labels. */
  preference: number;
  /** Stock headroom for the order and Valio Aimo's delivery reliability for the product. */
  availability: number;
  combined: number;
}

/** The weights from the substitute ranking in our Junction 2025 project. */
export const SCORE_WEIGHTS = { similarity: 0.3, price: 0.25, preference: 0.2, availability: 0.25 } as const;

export interface SubstitutesResult {
  /** The agent policy that was applied, when an agent asked. Its rules exclude candidates too. */
  policy: { agentId: string; buyerName: string } | null;
  /** Set when nothing qualifies: what the agent should do instead of guessing. */
  nextStep?: string;
  /** The next step in Finnish, for the buyer reading the interface in Finnish. */
  nextStepFi?: string;
  requested: {
    productId: string;
    productName: string;
    supplier: string;
    packages: number;
    quantity: Quantity;
    /** Empty when the requested product can fill the request as it is. */
    unmet: string[];
  };
  substitutes: Substitute[];
  excluded: { productId: string; supplier: string; reasons: string[]; reasonsFi: string[] }[];
}

/** Allergens a product in this category contains by its nature, declared or not. */
const CATEGORY_ALLERGENS: Partial<Record<ProductCategory, Allergen[]>> = {
  fish: ["fish"],
  eggs: ["eggs"],
  milk: ["milk"],
  cream: ["milk"],
  cheese: ["milk"],
  yoghurt: ["milk"],
};

/** Categories that can stand in for each other when the buyer's rules allow it. */
const RELATED_CATEGORIES: Partial<Record<ProductCategory, ProductCategory[]>> = {
  milk: ["plant-based"],
  "plant-based": ["milk"],
  cream: ["plant-based"],
};

/**
 * Categories whose products are not interchangeable as a group: beetroot does
 * not replace tomatoes. A substitute there must be a similar product by name.
 */
const LIKE_FOR_LIKE_ONLY = new Set<ProductCategory>(productCategorySchema.options.filter((category) => category !== "milk"));


/** What a product is, by the words of its name without its brand or generic words. */
const nameWords = (product: Product) => productWords(product.name, product.brand);

function packagesFor(product: Product, quantity: SubstituteRequest["quantity"], reference: Product): number | undefined {
  if (quantity.unit === "package") {
    // Whole packages of the requested product, converted to the same amount of the substitute.
    const amount = quantity.amount * reference.packageSize.amount;
    return product.packageSize.unit === reference.packageSize.unit
      ? Math.ceil(amount / product.packageSize.amount - 1e-9)
      : undefined;
  }
  if (product.packageSize.unit !== quantity.unit) return undefined;
  return Math.ceil(quantity.amount / product.packageSize.amount - 1e-9);
}

/** How closely a candidate matches the requested product, with readable notes. */
function match(candidate: Product, original: Product, role?: IngredientRole): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;

  // A processed product suits a sauce or soup base, which is what the recipe needs it for.
  if (role && PROCESSED_OK.has(role) && (candidate.category === "pantry" || candidate.category === "ready-meals") && original.category === "vegetables") {
    score += 20;
    notes.push(`suits a ${role}`);
  }

  // Valio Aimo's own substitution rules come first.
  if (original.substitutes.includes(candidate.id)) {
    score += 20;
    notes.push("Valio Aimo lists it as a substitute");
  }

  if (role === "main protein" && proteinKind(original.name) && proteinKind(candidate.name) === proteinKind(original.name)) {
    score += 10;
    notes.push(`the same kind of protein (${proteinKind(original.name)})`);
  }

  if (candidate.category === original.category) {
    score += 45;
    notes.push("same category");
  } else {
    score += 15;
    notes.push(`a ${candidate.category.replace("-", " ")} instead of ${original.category.replace("-", " ")}`);
  }

  const wanted = nameWords(original);
  const shared = sharedWords(nameWords(candidate), wanted);
  if (wanted.size > 0) score += Math.round((25 * shared.length) / wanted.size);
  if (shared.length > 0) notes.push(`similar product: ${shared.join(", ")}`);

  const sharedAttributes = original.attributes.filter((attribute) => candidate.attributes.includes(attribute));
  if (original.attributes.length > 0) score += Math.round((15 * sharedAttributes.length) / original.attributes.length);

  const a = candidate.nutrition;
  const b = original.nutrition;
  if (a && b && a.per === b.per) {
    const proteinClose = a.proteinG !== undefined && b.proteinG !== undefined && Math.abs(a.proteinG - b.proteinG) <= 1;
    const energyClose =
      a.energyKcal !== undefined && b.energyKcal !== undefined && Math.abs(a.energyKcal - b.energyKcal) <= Math.max(15, b.energyKcal * 0.25);
    if (proteinClose) score += 5;
    if (energyClose) score += 5;
    if (proteinClose && energyClose) notes.push("similar nutrition");
    if (b.calciumMg !== undefined) {
      // A fortified drink replaced by an unfortified one is a real nutritional step down.
      if ((a.calciumMg ?? 0) >= b.calciumMg * 0.8) score += 5;
      else {
        score -= 15;
        notes.push(`less calcium (${a.calciumMg ?? 0} mg against ${b.calciumMg} mg per 100 ml)`);
      }
    }
  }
  return { score: Math.max(0, Math.min(100, score)), notes };
}

function dayGap(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function tradeOffText(candidate: Product, original: Product, costEurCents: number, originalCostEurCents: number): string {
  const parts: string[] = [];
  const difference = costEurCents - originalCostEurCents;
  parts.push(
    Math.abs(difference) < 1
      ? "the same cost as requested"
      : `${formatEur(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than the requested product (${formatEur(costEurCents)} in total)`,
  );
  const gap = original.deliveryDate && candidate.deliveryDate ? dayGap(original.deliveryDate, candidate.deliveryDate) : 0;
  if (gap < 0) parts.push(`delivers ${-gap} ${gap === -1 ? "day" : "days"} sooner`);
  if (gap > 0) parts.push(`delivers ${gap} ${gap === 1 ? "day" : "days"} later`);
  const gained = candidate.labels.filter((label) => !original.labels.includes(label)).map((label) => LABEL_TEXT[label]);
  const lost = original.labels.filter((label) => !candidate.labels.includes(label)).map((label) => LABEL_TEXT[label]);
  if (gained.length > 0) parts.push(`adds ${gained.join(" and ")}`);
  if (lost.length > 0) parts.push(`not ${lost.join(" or ")}`);
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The same trade-off in Finnish. */
function tradeOffTextFi(candidate: Product, original: Product, costEurCents: number, originalCostEurCents: number): string {
  const parts: string[] = [];
  const difference = costEurCents - originalCostEurCents;
  parts.push(
    Math.abs(difference) < 1
      ? "sama hinta kuin pyydetyllä"
      : `${fiEur(Math.abs(difference))} ${difference > 0 ? "enemmän" : "vähemmän"} kuin pyydetty tuote (yhteensä ${fiEur(costEurCents)})`,
  );
  const gap = original.deliveryDate && candidate.deliveryDate ? dayGap(original.deliveryDate, candidate.deliveryDate) : 0;
  if (gap < 0) parts.push(`toimitus ${-gap} ${gap === -1 ? "päivän" : "päivää"} aiemmin`);
  if (gap > 0) parts.push(`toimitus ${gap} ${gap === 1 ? "päivän" : "päivää"} myöhemmin`);
  const gained = candidate.labels.filter((label) => !original.labels.includes(label)).map((label) => LABEL_FI[label]);
  const lost = original.labels.filter((label) => !candidate.labels.includes(label)).map((label) => LABEL_FI[label]);
  if (gained.length > 0) parts.push(`lisäksi ${fiList(gained)}`);
  if (lost.length > 0) parts.push(`ei ${lost.join(" tai ")}`);
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Picks the tiers: best is the closest match, good the cheapest of the rest, better the strongest remaining. */
/** The top three by combined score become best, better, and good. Ties go to the closer match, then the lower cost. */
function assignTiers<T extends { scores: SubstituteScores; costEurCents: number }>(candidates: T[]) {
  const tiers: Tier[] = ["best", "better", "good"];
  return [...candidates]
    .sort(
      (a, b) =>
        b.scores.combined - a.scores.combined || b.scores.similarity - a.scores.similarity || a.costEurCents - b.costEurCents,
    )
    .slice(0, 3)
    .map((candidate, index) => ({ ...candidate, tier: tiers[index]! }));
}

const percentText = (share: number) => `${Math.round(share * 100)}%`;

const UNIT_WORDS: Record<PackageUnit, string> = { litre: "litre", kilogram: "kg", piece: "piece" };

/** The four parts of the ranking for one candidate, with a note on each. */
function scoreCandidate(
  product: Product,
  original: Product,
  matchScore: number,
  policy: AgentPolicy | undefined,
  packages: number,
): { scores: SubstituteScores; scoreNotes: Substitute["scoreNotes"] } {
  // Compared per litre, kilogram, or piece, so rounding up to whole packages never counts against a product.
  const unit = UNIT_WORDS[product.packageSize.unit];
  const unitPrice = (candidate: Product) => candidate.pricePerPackageEurCents / candidate.packageSize.amount;
  const priceDelta = (unitPrice(product) - unitPrice(original)) / unitPrice(original);
  // Full marks at the same price or less, falling to zero at 50% more, as in our 2025 ranking.
  const price = Math.round(priceDelta <= 0 ? 100 : Math.max(0, 100 * (1 - priceDelta / 0.5)));

  // Every candidate shares the category, so the match score starts near 45; rescaling 40–100 to 0–100 lets real differences show.
  const similarity = Math.round(Math.max(0, Math.min(100, ((matchScore - 40) / 60) * 100)));

  const sameSupplier = product.supplier === original.supplier;
  const preferredSupplier = sameSupplier || (policy?.preferredSuppliers.includes(product.supplier) ?? false);
  const kept = original.labels.filter((label) => product.labels.includes(label));
  const labelShare = original.labels.length > 0 ? kept.length / original.labels.length : 1;
  const preference = Math.round(100 * (0.5 * labelShare + 0.5 * (preferredSupplier ? 1 : 0.6)));

  const headroom = Math.min(1, product.availablePackages / (2 * packages));
  // Without a delivery record, reliability counts as average rather than perfect.
  const reliability = product.deliveryReliability;
  const availability = Math.round(100 * (0.6 * headroom + 0.4 * (reliability ?? 0.9)));

  const combined = Math.round(
    SCORE_WEIGHTS.similarity * similarity +
      SCORE_WEIGHTS.price * price +
      SCORE_WEIGHTS.preference * preference +
      SCORE_WEIGHTS.availability * availability,
  );

  return {
    scores: { similarity, price, preference, availability, combined },
    scoreNotes: {
      price:
        Math.abs(priceDelta) < 0.005
          ? `the same price per ${unit} as the requested product`
          : `${percentText(Math.abs(priceDelta))} ${priceDelta < 0 ? "less" : "more"} per ${unit} than the requested product`,
      preference: [
        sameSupplier ? "same supplier as requested" : preferredSupplier ? "a preferred supplier" : "a different supplier",
        original.labels.length === 0
          ? "the requested product had no labels to keep"
          : kept.length === original.labels.length
            ? "keeps every label"
            : kept.length === 0
              ? "keeps none of the requested labels"
              : `keeps ${kept.length} of ${original.labels.length} labels`,
      ].join(", "),
      availability: `${product.stockStatus === "unknown" ? "amount not reported, any quantity can be ordered" : product.stockStatus === "unconfirmed" ? "delivered from the supplier's warehouse, amount unconfirmed" : `stock covers the order ${Math.floor(product.availablePackages / packages)} times over`}; ${reliability !== undefined ? `${Math.round(reliability * 100)}% delivered as ordered` : "no delivery record"}`,
    },
  };
}

/**
 * Reasons a product breaks the agent's policy, apart from the spending limit,
 * which depends on the whole quote. Allergen conflicts would be blocked;
 * the other rules would need the buyer's approval, so neither is proposed.
 */
/** The same reasons as policyReasons, each with its Finnish. */
export function policyReasonPairs(policy: AgentPolicy, product: Product): { en: string; fi: string }[] {
  return guardrailChecks(policy, [product], 0)
    .filter((check) => check.rule !== "spending_limit" && check.outcome !== "passed")
    .map((check) =>
      check.outcome === "blocked"
        ? {
            en: `${check.detail.replace(`${product.name} (${product.supplier}) `, "")}, which ${policy.buyerName}'s allergen rule blocks`,
            fi: `${check.detailFi.replace(`${product.nameFi} (${product.supplier}) `, "")}, minkä ostajan allergeenisääntö estää`,
          }
        : {
            en: `${check.detail.replace(`${product.name} `, "")}, so ${policy.buyerName} would have to approve it`,
            fi: `${check.detailFi}, joten ostajan pitäisi hyväksyä se`,
          },
    );
}

export function policyReasons(policy: AgentPolicy, product: Product): string[] {
  return guardrailChecks(policy, [product], 0)
    .filter((check) => check.rule !== "spending_limit" && check.outcome !== "passed")
    .map((check) =>
      check.outcome === "blocked"
        ? `${check.detail.replace(`${product.name} (${product.supplier}) `, "")}, which ${policy.buyerName}'s allergen rule blocks`
        : `${check.detail.replace(`${product.name} `, "")}, so ${policy.buyerName} would have to approve it`,
    );
}

export function findSubstitutes(
  products: Product[],
  request: SubstituteRequest,
  policy?: AgentPolicy,
): SubstitutesResult {
  const original = products.find((product) => product.id === request.productId);
  if (!original) throw new ApiError(404, `Unknown product "${request.productId}".`);

  const originalPackages = packagesFor(original, request.quantity, original);
  if (originalPackages === undefined) {
    throw new ApiError(
      400,
      `${original.id} is sold in ${original.packageSize.unit}s, so ask for packages or ${original.packageSize.unit}s.`,
    );
  }
  const unmet = unmetRequirements(original, request.requirements);
  if (policy) unmet.push(...policyReasons(policy, original));
  if (original.availablePackages < originalPackages) {
    unmet.push(
      original.availablePackages === 0
        ? "out of stock"
        : `only ${original.availablePackages} packages in stock, ${originalPackages} needed`,
    );
  }
  const originalCost = originalPackages * original.pricePerPackageEurCents;

  const allowedCategories = [original.category, ...(RELATED_CATEGORIES[original.category] ?? [])];
  // With a role, fresh vegetables are compared with processed ones too: allowed in a sauce, ruled out in a salad.
  const crossToPantry = request.role !== undefined && original.category === "vegetables";
  if (crossToPantry) allowedCategories.push("pantry", "ready-meals");
  const candidates: Omit<Substitute, "tier">[] = [];
  const excluded: SubstitutesResult["excluded"] = [];

  for (const product of products) {
    if (product.id === original.id || (!allowedCategories.includes(product.category) && !original.substitutes.includes(product.id))) continue;
    const packages = packagesFor(product, request.quantity, original);
    if (packages === undefined) continue;
    // Only processed versions of the same product cross over, for example crushed tomatoes for tomatoes.
    const processed = crossToPantry && (product.category === "pantry" || product.category === "ready-meals");
    if (processed && sharedWords(nameWords(product), nameWords(original)).length === 0) continue;

    const reasons = unmetRequirements(product, request.requirements);
    const reasonsFi = reasons.map(requirementFi);
    if (!request.allowNewAllergens) {
      // Allergens the buyer's own rules exclude are already reported, so they are not repeated here.
      const known = new Set([
        ...original.allergens,
        ...original.mayContain,
        // A fish fillet without a declaration is still fish: a category's own allergen is never "added".
        ...(CATEGORY_ALLERGENS[original.category] ?? []),
        ...(request.requirements.excludeAllergens ?? []),
        ...(policy?.excludedAllergens ?? []),
      ]);
      const added = [...new Set([...product.allergens, ...product.mayContain])].filter((allergen) => !known.has(allergen));
      if (added.length > 0) {
        reasons.push(`adds ${added.join(" and ")}, which the requested product does not contain`);
        reasonsFi.push(`lisää allergeenin ${fiList(added.map((allergen) => ALLERGEN_FI[allergen]))}, jota pyydetty tuote ei sisällä`);
      }
    }
    if (policy) {
      for (const reason of policyReasonPairs(policy, product)) {
        // The same allergen can already be excluded by the request itself.
        if (!reasons.some((existing) => reason.en.startsWith(existing))) {
          reasons.push(reason.en);
          reasonsFi.push(reason.fi);
        }
      }
    }
    if (processed && request.role && FRESH_ONLY.has(request.role)) {
      reasons.push(`processed, so it cannot be used as a ${request.role}`);
      reasonsFi.push("prosessoitu tuote, joten se ei sovi tähän käyttötarkoitukseen");
    }
    if (LIKE_FOR_LIKE_ONLY.has(original.category) && !original.substitutes.includes(product.id)) {
      const wanted = nameWords(original);
      if (sharedWords(nameWords(product), wanted).length === 0) {
        reasons.push(`a different product, not a like-for-like substitute for ${original.name.toLowerCase()}`);
        reasonsFi.push(`eri tuote, ei vastaava korvike tuotteelle ${original.nameFi}`);
      }
      // In a dish, a main protein is swapped only for the same kind: salmon for trout, never for herring.
      const kind = proteinKind(original.name);
      const candidateKind = proteinKind(product.name);
      if (request.role === "main protein" && kind && candidateKind !== kind) {
        reasons.push(`${candidateKind ?? "not"} ${candidateKind ? "instead of" : "the same kind as"} ${kind}, which changes the dish`);
        reasonsFi.push("eri raaka-aine kuin alkuperäisessä, mikä muuttaa ruokalajia");
      }
      const missingForm = formWords(original.name).filter((form) => !formWords(product.name).includes(form));
      if (missingForm.length > 0 && !reasons.some((reason) => reason.startsWith("a different product"))) {
        reasons.push(`not a ${missingForm.join(" ")} product, unlike ${original.name.toLowerCase()}`);
        reasonsFi.push(`eri muoto kuin tuotteella ${original.nameFi}`);
      }
    }
    if (product.availablePackages < packages) {
      reasons.push(product.availablePackages === 0 ? "out of stock" : `only ${product.availablePackages} packages in stock, ${packages} needed`);
      reasonsFi.push(product.availablePackages === 0 ? "loppu varastosta" : `varastossa vain ${product.availablePackages} myyntierää, tarvitaan ${packages}`);
    }
    if (reasons.length > 0) {
      excluded.push({ productId: product.id, supplier: product.supplier, reasons, reasonsFi });
      continue;
    }

    const costEurCents = packages * product.pricePerPackageEurCents;
    const { score, notes } = match(product, original, request.role);
    candidates.push({
      productId: product.id,
      productName: product.name,
      supplier: product.supplier,
      packages,
      quantity: { amount: packages * product.packageSize.amount, unit: product.packageSize.unit },
      costEurCents,
      deliveryDate: product.deliveryDate,
      matchScore: score,
      matchNotes: notes,
      tradeOff: tradeOffText(product, original, costEurCents, originalCost),
      tradeOffFi: tradeOffTextFi(product, original, costEurCents, originalCost),
      ...scoreCandidate(product, original, score, policy, packages),
    });
  }

  const substitutes = assignTiers(candidates);
  return {
    policy: policy ? { agentId: policy.agentId, buyerName: policy.buyerName } : null,
    ...(substitutes.length === 0
      ? {
          nextStep: `No product in the catalog meets every rule${policy ? ` of ${policy.buyerName}` : ""}. Do not order anything else. Ask the buyer how to proceed.`,
          nextStepFi: "Mikään valikoiman tuote ei täytä kaikkia sääntöjä. Älä tilaa mitään muuta, vaan kysy ostajalta, miten edetään.",
        }
      : {}),
    requested: {
      productId: original.id,
      productName: original.name,
      supplier: original.supplier,
      packages: originalPackages,
      quantity: { amount: originalPackages * original.packageSize.amount, unit: original.packageSize.unit },
      unmet,
    },
    substitutes,
    excluded,
  };
}
