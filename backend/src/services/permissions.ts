import { activeMandate } from "./mandates.js";
import type { Principal } from "../auth.js";
import { ApiError } from "../http.js";
import type { Allergen, Label, Product, ProductCategory } from "../schemas/product.js";
import type { Store } from "../store.js";
import { acceptsUndeclared } from "../data/catalogMapping.js";
import { earnedAutonomyCheck, recordSetback, totalsByCategory, type AutonomySettings } from "./autonomy.js";
import { ALLERGEN_FI, ATTRIBUTE_FI, CATEGORY_FI, fiDate, fiEur, fiList } from "../i18n.js";
import { helsinkiDate } from "./dates.js";

/** Minimum nutrition per 100 ml or 100 g, for example calcium in a school's milk alternative. */
export interface NutritionMinimum {
  calciumMg?: number;
  proteinG?: number;
  /** Words of the product name the rule applies to, in English or Finnish, such as drinks. Every product in the category when left out. */
  appliesTo?: string[];
}

/**
 * What an agent may decide alone, set by the buyer and held on the server.
 * No endpoint can change it.
 */
export interface AgentPolicy {
  agentId: string;
  agentName: string;
  /** Whose rules these are, for example "Hotel chain" or "School kitchen". */
  buyerName: string;
  /** The largest quote total the agent may order without the buyer's approval. */
  spendingLimitEurCents: number;
  /**
   * The most the agent may commit on its own in one day, across all its quotes.
   * It stops an agent from splitting one purchase into several quotes under the limit.
   */
  dailyLimitEurCents: number;
  /** Hard rule: a quote with any of these allergens, even as traces, is blocked and cannot be approved. */
  excludedAllergens: Allergen[];
  /** Soft rule: a product from any other supplier needs the buyer's approval. Empty means any supplier. */
  preferredSuppliers: string[];
  /** Soft rule: every product must carry these labels, or the buyer must approve. */
  requiredLabels: Label[];
  /** Soft rule per category, for example milk must be lactose-free. */
  requiredAttributes: Partial<Record<ProductCategory, string[]>>;
  /** Soft rule per category, for example plant drinks need at least 100 mg calcium per 100 ml. */
  nutritionMinimums: Partial<Record<ProductCategory, NutritionMinimum>>;
  /** Whether the agent must earn the right to order alone, category by category, from the buyer's approvals. */
  autonomy: AutonomySettings;
}

export type PermissionDecision = "within_limit" | "needs_approval" | "created_by_buyer";

export type GuardrailRule =
  | "spending_limit"
  | "daily_limit"
  | "allergens"
  | "preferred_suppliers"
  | "required_labels"
  | "required_attributes"
  | "nutrition"
  | "standing_order_drift"
  | "wholesaler_suggestion"
  | "mandate"
  | "allergen_declaration"
  | "stock_confirmation"
  | "earned_autonomy";

/** One rule applied to one quote, with its outcome in plain language. */
export interface GuardrailCheck {
  rule: GuardrailRule;
  outcome: "passed" | "needs_approval" | "blocked";
  detail: string;
  /** The same detail in Finnish, for the interface's Finnish view. */
  detailFi: string;
}

export interface PermissionCheck {
  decision: PermissionDecision;
  totalEurCents: number;
  /** The limit that applied, or null when the buyer created the quote. */
  limitEurCents: number | null;
  reason: string;
  /** The reason in Finnish. */
  reasonFi: string;
  /** Every rule that was checked, so the buyer can see why the decision came out as it did. */
  checks: GuardrailCheck[];
  checkedAt: string;
}

export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency: "EUR" });
}

function list(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Applies the policy's rules to the products in a quote. Pure, so it can also explain a policy before quoting. */
export function guardrailChecks(policy: AgentPolicy, products: Product[], totalEurCents: number): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];
  const limit = formatEur(policy.spendingLimitEurCents);
  checks.push(
    totalEurCents <= policy.spendingLimitEurCents
      ? {
          rule: "spending_limit",
          outcome: "passed",
          detail: `${formatEur(totalEurCents)} is within the limit of ${limit}`,
          detailFi: `${fiEur(totalEurCents)} on rajan ${fiEur(policy.spendingLimitEurCents)} sisällä`,
        }
      : {
          rule: "spending_limit",
          outcome: "needs_approval",
          detail: `the total of ${formatEur(totalEurCents)} exceeds the agent's limit of ${limit}`,
          detailFi: `kokonaissumma ${fiEur(totalEurCents)} ylittää agentin rajan ${fiEur(policy.spendingLimitEurCents)}`,
        },
  );

  if (policy.excludedAllergens.length > 0) {
    const conflicts = products.flatMap((product) =>
      policy.excludedAllergens.flatMap((allergen) =>
        product.allergens.includes(allergen)
          ? [{ en: `${product.name} (${product.supplier}) contains ${allergen}`, fi: `${product.nameFi} (${product.supplier}) sisältää: ${ALLERGEN_FI[allergen]}` }]
          : product.mayContain.includes(allergen)
            ? [{ en: `${product.name} (${product.supplier}) may contain ${allergen}`, fi: `${product.nameFi} (${product.supplier}) voi sisältää: ${ALLERGEN_FI[allergen]}` }]
            : [],
      ),
    );
    checks.push(
      conflicts.length > 0
        ? { rule: "allergens", outcome: "blocked", detail: list(conflicts.map((c) => c.en)), detailFi: fiList(conflicts.map((c) => c.fi)) }
        : {
            rule: "allergens",
            outcome: "passed",
            detail: `free from ${list(policy.excludedAllergens)}`,
            detailFi: `ei sisällä: ${fiList(policy.excludedAllergens.map((allergen) => ALLERGEN_FI[allergen]))}`,
          },
    );
  }

  // A product without an allergen declaration cannot be shown to be free of the excluded allergens.
  if (policy.excludedAllergens.length > 0) {
    const undeclared = products.filter((product) => !product.allergensDeclared);
    const unverified = undeclared.filter((product) => !acceptsUndeclared(product.category));
    const fresh = undeclared.filter((product) => acceptsUndeclared(product.category));
    const excludedFi = fiList(policy.excludedAllergens.map((allergen) => ALLERGEN_FI[allergen]));
    if (unverified.length > 0) {
      checks.push({
        rule: "allergen_declaration",
        outcome: "needs_approval",
        detail: `${list(unverified.map((product) => product.name))} ${unverified.length === 1 ? "has" : "have"} no allergen declaration from the manufacturer, so it cannot be shown to be free from ${list(policy.excludedAllergens)}`,
        detailFi: `valmistaja ei ole ilmoittanut allergeeneja tuotteelle ${fiList(unverified.map((product) => product.nameFi))}, joten sen ei voida osoittaa olevan vapaa näistä: ${excludedFi}`,
      });
    } else if (fresh.length > 0) {
      checks.push({
        rule: "allergen_declaration",
        outcome: "passed",
        detail: `${list(fresh.map((product) => product.name))} ${fresh.length === 1 ? "is" : "are"} unprocessed fresh produce without an allergen declaration, which the buyer's rules accept`,
        detailFi: `${fiList(fresh.map((product) => product.nameFi))} on käsittelemätöntä tuoretuotetta ilman allergeeni-ilmoitusta, minkä ostajan säännöt hyväksyvät`,
      });
    }
  }

  // Valio Aimo cannot see stock delivered from a supplier's own warehouse; the supplier confirms it with the order.
  const unconfirmed = products.filter((product) => product.stockStatus === "unconfirmed");
  if (unconfirmed.length > 0) {
    checks.push({
      rule: "stock_confirmation",
      outcome: "passed",
      detail: `${list(unconfirmed.map((product) => product.name))} ${unconfirmed.length === 1 ? "comes" : "come"} from the supplier's own warehouse, so the supplier confirms the amount with the order`,
      detailFi: `${fiList(unconfirmed.map((product) => product.nameFi))} toimitetaan toimittajan omasta varastosta, joten toimittaja vahvistaa määrän tilauksen yhteydessä`,
    });
  }

  if (policy.preferredSuppliers.length > 0) {
    const others = [...new Set(products.map((product) => product.supplier))].filter(
      (supplier) => !policy.preferredSuppliers.includes(supplier),
    );
    checks.push(
      others.length > 0
        ? {
            rule: "preferred_suppliers",
            outcome: "needs_approval",
            detail: `${list(others)} ${others.length === 1 ? "is not a preferred supplier" : "are not preferred suppliers"}`,
            detailFi: `${fiList(others)} ei ole ensisijainen toimittaja`,
          }
        : { rule: "preferred_suppliers", outcome: "passed", detail: "every supplier is a preferred supplier", detailFi: "kaikki toimittajat ovat ensisijaisia" },
    );
  }

  if (policy.requiredLabels.length > 0) {
    const missing = products.flatMap((product) => {
      const lacking = policy.requiredLabels.filter((label) => !product.labels.includes(label));
      return lacking.length > 0 ? [{ en: `${product.name} has no ${list(lacking)} label`, fi: `tuotteella ${product.nameFi} ei ole merkintää ${fiList(lacking)}` }] : [];
    });
    checks.push(
      missing.length > 0
        ? { rule: "required_labels", outcome: "needs_approval", detail: list(missing.map((m) => m.en)), detailFi: fiList(missing.map((m) => m.fi)) }
        : {
            rule: "required_labels",
            outcome: "passed",
            detail: `every product carries ${list(policy.requiredLabels)}`,
            detailFi: `jokaisessa tuotteessa on merkintä ${fiList(policy.requiredLabels)}`,
          },
    );
  }

  const attributeFailures = products.flatMap((product) => {
    const required = policy.requiredAttributes[product.category] ?? [];
    const lacking = required.filter((attribute) => !product.attributes.includes(attribute));
    return lacking.length > 0
      ? [
          {
            en: `${product.name} is not ${list(lacking)}, which the buyer requires for ${product.category}`,
            fi: `${product.nameFi} ei ole ${fiList(lacking.map(attributeFi))}, mitä ostaja edellyttää tuoteryhmässä ${CATEGORY_FI[product.category]}`,
          },
        ]
      : [];
  });
  if (Object.keys(policy.requiredAttributes).length > 0) {
    checks.push(
      attributeFailures.length > 0
        ? { rule: "required_attributes", outcome: "needs_approval", detail: list(attributeFailures.map((a) => a.en)), detailFi: fiList(attributeFailures.map((a) => a.fi)) }
        : {
            rule: "required_attributes",
            outcome: "passed",
            detail: "every product has the attributes the buyer requires",
            detailFi: "jokaisella tuotteella on ostajan edellyttämät ominaisuudet",
          },
    );
  }

  const nutritionFailures = products.flatMap((product) => {
    const minimum = policy.nutritionMinimums[product.category];
    if (!minimum) return [];
    const name = `${product.name} ${product.nameFi}`.toLowerCase();
    if (minimum.appliesTo && !minimum.appliesTo.some((word) => name.includes(word))) return [];
    const nutrition = product.nutrition;
    if (!nutrition) {
      return [
        {
          en: `${product.name} has no nutrition declaration, so the buyer's nutrition rule cannot be checked`,
          fi: `tuotteella ${product.nameFi} ei ole ravintoarvoilmoitusta, joten ostajan ravintosääntöä ei voida tarkistaa`,
        },
      ];
    }
    const per = nutrition.per === "100ml" ? "100 ml" : "100 g";
    const failures: { en: string; fi: string }[] = [];
    if (minimum.calciumMg !== undefined && (nutrition.calciumMg ?? 0) < minimum.calciumMg) {
      failures.push({
        en: `${product.name} has ${nutrition.calciumMg ?? 0} mg calcium per ${per}, below the ${minimum.calciumMg} mg minimum`,
        fi: `tuotteessa ${product.nameFi} on kalsiumia ${nutrition.calciumMg ?? 0} mg / ${per}, alle vähimmäismäärän ${minimum.calciumMg} mg`,
      });
    }
    if (minimum.proteinG !== undefined && (nutrition.proteinG ?? 0) < minimum.proteinG) {
      failures.push({
        en: `${product.name} has ${nutrition.proteinG ?? 0} g protein per ${per}, below the ${minimum.proteinG} g minimum`,
        fi: `tuotteessa ${product.nameFi} on proteiinia ${nutrition.proteinG ?? 0} g / ${per}, alle vähimmäismäärän ${minimum.proteinG} g`,
      });
    }
    return failures;
  });
  if (Object.keys(policy.nutritionMinimums).length > 0) {
    checks.push(
      nutritionFailures.length > 0
        ? { rule: "nutrition", outcome: "needs_approval", detail: list(nutritionFailures.map((n) => n.en)), detailFi: fiList(nutritionFailures.map((n) => n.fi)) }
        : {
            rule: "nutrition",
            outcome: "passed",
            detail: "every product meets the buyer's nutrition rules",
            detailFi: "jokainen tuote täyttää ostajan ravintosäännöt",
          },
    );
  }
  return checks;
}

/** Product attributes in Finnish, for the rules that require them. */
const attributeFi = (attribute: string) => ATTRIBUTE_FI[attribute] ?? attribute;

/**
 * Decides whether the creator may order a quote alone. The rules live only on
 * the server: no request can set or loosen them. An allergen conflict blocks
 * the quote outright, because no approval can make it safe.
 */
export function checkPermission(
  store: Store,
  principal: Principal,
  products: Product[],
  totalEurCents: number,
  /** Rules that apply to this kind of quote only, such as the drift check on a standing order renewal. */
  extraChecks: GuardrailCheck[] = [],
  /** Each product's line total, in the same order, so earned autonomy can be checked per category. */
  lineTotalsEurCents: number[] = products.map(() => totalEurCents / Math.max(1, products.length)),
  /**
   * When an existing quote is checked again just before ordering: the quote itself is left out of
   * today's commitments, and a failed check costs the agent no autonomy, since it did nothing wrong.
   */
  context: { excludeQuoteId?: string; recordSetbacks?: boolean } = {},
): PermissionCheck {
  const checkedAt = store.clock().toISOString();
  const recordSetbacks = context.recordSetbacks ?? true;

  if (principal.role === "buyer") {
    return {
      decision: "created_by_buyer",
      totalEurCents,
      limitEurCents: null,
      reason: "The buyer created this quote, so it needs no further approval.",
      reasonFi: "Ostaja teki tarjouksen itse, joten se ei tarvitse muuta hyväksyntää.",
      checks: [],
      checkedAt,
    };
  }

  const policy = store.policies.get(principal.id);
  if (!policy) {
    // With no policy on record, the agent may not spend anything on its own.
    throw new ApiError(403, `No purchasing policy exists for agent ${principal.id}.`);
  }

  // The buyer's mandate bounds the agent: a category outside it is refused outright, and a total above its limit needs approval.
  const mandate = activeMandate(store.mandates, principal.id);
  if (!mandate) throw new ApiError(403, `Refused: ${principal.name} has no mandate from the buyer.`, { mandate: true });
  const outside = [...new Set(products.map((product) => product.category))].filter((category) => !mandate.allowedCategories.includes(category));
  if (outside.length > 0) {
    if (recordSetbacks) recordSetback(store, principal, policy, outside, "refused", `Refused: outside the buyer's mandate ${mandate.id}.`);
    throw new ApiError(
      403,
      `Refused: ${outside.join(" and ")} ${outside.length === 1 ? "is" : "are"} outside the buyer's mandate ${mandate.id}, which allows ${mandate.allowedCategories.join(", ")}.`,
      { mandate: true, mandateId: mandate.id },
    );
  }

  const checks = guardrailChecks(policy, products, totalEurCents);
  checks.splice(1, 0, dailyLimitCheck(store, policy, totalEurCents, context.excludeQuoteId));
  checks.push({
    rule: "mandate",
    outcome: totalEurCents > mandate.spendingLimitEurCents ? "needs_approval" : "passed",
    detail:
      totalEurCents > mandate.spendingLimitEurCents
        ? `${formatEur(totalEurCents)} is above the ${formatEur(mandate.spendingLimitEurCents)} the buyer's mandate ${mandate.id} allows`
        : `within the buyer's signed mandate ${mandate.id}, valid until ${mandate.expiresAt.slice(0, 10)}`,
    detailFi:
      totalEurCents > mandate.spendingLimitEurCents
        ? `${fiEur(totalEurCents)} ylittää ostajan valtuutuksen ${mandate.id} salliman ${fiEur(mandate.spendingLimitEurCents)}`
        : `ostajan allekirjoittaman valtuutuksen ${mandate.id} rajoissa, voimassa ${fiDate(mandate.expiresAt)} asti`,
  });
  checks.push(...extraChecks);
  const autonomy = earnedAutonomyCheck(store, policy, totalsByCategory(products, lineTotalsEurCents));
  if (autonomy) checks.push(autonomy);
  const blocked = checks.filter((check) => check.outcome === "blocked");
  if (blocked.length > 0) {
    // An attempt the rules block costs the agent its run of approvals in those categories.
    const conflicting = products.filter((product) => [...product.allergens, ...product.mayContain].some((allergen) => policy.excludedAllergens.includes(allergen)));
    if (recordSetbacks) {
      recordSetback(store, principal, policy, (conflicting.length > 0 ? conflicting : products).map((product) => product.category), "refused", `Blocked by the allergen rule: ${blocked.map((check) => check.detail).join("; ")}.`);
    }
    throw new ApiError(
      422,
      `Blocked by ${policy.buyerName}'s allergen rule: ${blocked.map((check) => check.detail).join("; ")}. This cannot be approved. Choose a product that is free from ${list(policy.excludedAllergens)}.`,
      { blocked: true, checks },
    );
  }

  const total = formatEur(totalEurCents);
  const limit = formatEur(policy.spendingLimitEurCents);
  const failures = checks.filter((check) => check.outcome === "needs_approval");
  if (failures.length === 0) {
    return {
      decision: "within_limit",
      totalEurCents,
      limitEurCents: policy.spendingLimitEurCents,
      reason: `The total of ${total} is within the agent's limit of ${limit}, so the agent may order it.`,
      reasonFi: `Kokonaissumma ${fiEur(totalEurCents)} on agentin rajan ${fiEur(policy.spendingLimitEurCents)} sisällä, joten agentti voi tilata sen.`,
      checks,
      checkedAt,
    };
  }

  // A mandate limit no tighter than the policy's says the same thing, so the plain reason names the limit once.
  const repeatsSpending = (check: GuardrailCheck) => check.rule === "mandate" && mandate.spendingLimitEurCents >= policy.spendingLimitEurCents;
  const onlySpending = failures.every((check) => check.rule === "spending_limit" || repeatsSpending(check));
  return {
    decision: "needs_approval",
    totalEurCents,
    limitEurCents: policy.spendingLimitEurCents,
    reason: onlySpending
      ? `The total of ${total} exceeds the agent's limit of ${limit}, so the buyer must approve it.`
      : `The buyer must approve it: ${failures.filter((check) => !repeatsSpending(check)).map((check) => check.detail).join("; ")}.`,
    reasonFi: onlySpending
      ? `Kokonaissumma ${fiEur(totalEurCents)} ylittää agentin rajan ${fiEur(policy.spendingLimitEurCents)}, joten ostajan on hyväksyttävä se.`
      : `Ostajan on hyväksyttävä: ${failures.filter((check) => !repeatsSpending(check)).map((check) => check.detailFi).join("; ")}.`,
    checks,
    checkedAt,
  };
}

/**
 * What the agent has committed on its own authority today, in Helsinki time:
 * the orders it placed today without the buyer's approval, counted on the day
 * they were placed, plus its open quotes that it may still order alone, which
 * hold their amount until they are ordered or expire. Quotes and orders the
 * buyer approved do not count, because a person signed them off.
 */
export function committedToday(store: Store, agentId: string, now: Date = store.clock(), excludeQuoteId?: string): number {
  const today = helsinkiDate(now);
  let total = 0;
  for (const order of store.orders.values()) {
    const quote = store.quotes.get(order.quoteId);
    if (!quote || quote.id === excludeQuoteId || quote.createdBy.id !== agentId) continue;
    if (quote.buyerDecision || quote.permission.decision !== "within_limit") continue;
    if (helsinkiDate(new Date(order.placedAt)) === today) total += order.totalEurCents;
  }
  for (const quote of store.quotes.values()) {
    if (quote.id === excludeQuoteId || quote.createdBy.id !== agentId || quote.status !== "within_limit") continue;
    if (new Date(quote.expiresAt ?? quote.createdAt).getTime() <= now.getTime()) continue;
    total += quote.totalEurCents;
  }
  return total;
}

function dailyLimitCheck(store: Store, policy: AgentPolicy, totalEurCents: number, excludeQuoteId?: string): GuardrailCheck {
  const committed = committedToday(store, policy.agentId, store.clock(), excludeQuoteId);
  const after = committed + totalEurCents;
  const limit = formatEur(policy.dailyLimitEurCents);
  // The daily limit catches splitting. A single quote is the spending limit's job, so with nothing
  // else committed today this check has nothing to add. The daily limit is never set below the spending limit.
  if (committed === 0) {
    return {
      rule: "daily_limit",
      outcome: "passed",
      detail: `nothing else committed today; the daily limit is ${limit}`,
      detailFi: `tänään ei ole muita sitoumuksia; päiväraja on ${fiEur(policy.dailyLimitEurCents)}`,
    };
  }
  if (after <= policy.dailyLimitEurCents) {
    return {
      rule: "daily_limit",
      outcome: "passed",
      detail: `${formatEur(after)} committed today with this quote, within the daily limit of ${limit}`,
      detailFi: `tämän tarjouksen kanssa tänään sitoutunut ${fiEur(after)}, päivärajan ${fiEur(policy.dailyLimitEurCents)} sisällä`,
    };
  }
  return {
    rule: "daily_limit",
    outcome: "needs_approval",
    detail: `${formatEur(committed)} is already committed today, and this quote would take it to ${formatEur(after)}, over the daily limit of ${limit}`,
    detailFi: `tänään on jo sitoutunut ${fiEur(committed)}, ja tämä tarjous nostaisi sen summaan ${fiEur(after)}, yli päivärajan ${fiEur(policy.dailyLimitEurCents)}`,
  };
}
