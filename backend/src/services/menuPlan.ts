import { recipes } from "../data/recipes.js";
import { ApiError } from "../http.js";
import type { IngredientRole, PackageUnit } from "../schemas/product.js";
import type { Store } from "../store.js";
import { formatEur } from "./permissions.js";
import { findSubstitutes } from "./substitutes.js";

/**
 * Need → recipe → order: works out what a menu needs, subtracts what the
 * kitchen has, and rounds up to whole packages. The server does the
 * arithmetic, so the quantities never depend on a model's mental maths.
 */

export interface MenuPlanRow {
  productId: string;
  productName: string;
  supplier: string;
  unit: PackageUnit;
  /** The dishes that use it. */
  dishes: string[];
  needed: number;
  onHand: number;
  toOrder: number;
  packageSize: number;
  packages: number;
  /** What the packages contain, which can be a little more than toOrder. */
  orderedAmount: number;
  costEurCents: number;
  /** Null when Valio Aimo cannot deliver it on any date. */
  deliveryDate: string | null;
  /** Set when the product cannot be ordered as planned: no stock, too little, or too late. */
  problem?: string;
  /** With too little stock: the packages Valio Aimo can deliver, which the plan keeps before substituting the rest. */
  keepPackages?: number;
  /** What each dish needs of it, and the ingredient's role there. */
  uses: { dish: string; role: IngredientRole; needed: number }[];
  /** For a problem row: a substitute per dish, chosen for the ingredient's role in that dish. */
  substitutions?: Substitution[];
}

/** How one dish's share of a problem ingredient is covered instead. */
export interface Substitution {
  dish: string;
  role: IngredientRole;
  /** What this dish still needs after the kitchen's own stock of the original. */
  shortfall: number;
  unit: PackageUnit;
  /** The chosen substitute, or none when nothing suitable can arrive in time. */
  choice?: {
    /** "stock" uses what the kitchen already has spare; "order" buys it. */
    source: "stock" | "order";
    productId: string;
    productName: string;
    supplier: string;
    amount: number;
    unit: PackageUnit;
    deliveryDate?: string;
  };
  /** Why it suits the dish, or why nothing does. */
  note: string;
  /** Products ruled out for this role, with the reason, for example processed tomatoes in a salad. */
  ruledOut: { productId: string; productName: string; reason: string }[];
}

export interface MenuPlan {
  id: string;
  createdAt: string;
  createdBy: { id: string; role: string; name: string };
  /** The kitchen, by its agent's ID. */
  agentId: string;
  dishes: { recipeId: string; name: string; portions: number }[];
  deliverBy?: string;
  rows: MenuPlanRow[];
  /** The cost of everything that can be ordered as planned. */
  totalEurCents: number;
  /** Quote lines for the rows without a problem, ready for POST /api/quotes. */
  lines: { productId: string; quantity: { amount: number; unit: "package" } }[];
  /** One sentence per problem, for the agent to resolve, for example with substitutes. */
  problems: string[];
  /** One sentence per substitution, for example "Roast tomato pasta sauce: 2 kg of crushed tomatoes from stock". */
  resolutions: string[];
  /** The plan's lines plus the substitutes to order. Use these when the buyer accepts the substitutions. */
  linesWithSubstitutes: { productId: string; quantity: { amount: number; unit: "package" } }[];
  /** The cost of linesWithSubstitutes. */
  totalWithSubstitutesEurCents: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

const UNIT_TEXT: Record<PackageUnit, string> = { litre: "L", kilogram: "kg", piece: "pcs" };
const amountText = (amount: number, unit: PackageUnit) => `${round(amount)} ${UNIT_TEXT[unit] ?? unit}`;

export function planMenu(
  store: Store,
  input: { agentId: string; dishes: { recipeId: string; portions: number }[]; deliverBy?: string },
  principal: { id: string; role: string; name: string },
): MenuPlan {
  const rows = new Map<string, MenuPlanRow>();
  const dishes = input.dishes.map(({ recipeId, portions }) => {
    const recipe = recipes.find((candidate) => candidate.id === recipeId && candidate.kitchens.includes(input.agentId as never));
    if (!recipe) throw new ApiError(404, `Unknown recipe "${recipeId}" for this kitchen.`);
    for (const ingredient of recipe.ingredients) {
      const product = store.products.find((candidate) => candidate.id === ingredient.productId)!;
      const row =
        rows.get(product.id) ??
        ({
          productId: product.id,
          productName: product.name,
          supplier: product.supplier,
          unit: product.packageSize.unit,
          dishes: [],
          needed: 0,
          onHand: 0,
          toOrder: 0,
          packageSize: product.packageSize.amount,
          packages: 0,
          orderedAmount: 0,
          costEurCents: 0,
          deliveryDate: product.deliveryDate,
          uses: [],
        } satisfies MenuPlanRow);
      const needed = round(ingredient.quantityPerPortion.amount * portions);
      row.needed = round(row.needed + needed);
      if (!row.dishes.includes(recipe.name)) row.dishes.push(recipe.name);
      row.uses.push({ dish: recipe.name, role: ingredient.role, needed });
      rows.set(product.id, row);
    }
    return { recipeId, name: recipe.name, portions };
  });

  const inventory = store.inventory[input.agentId] ?? [];
  const problems: string[] = [];
  for (const row of rows.values()) {
    const product = store.products.find((candidate) => candidate.id === row.productId)!;
    row.onHand = inventory.find((item) => item.productId === row.productId)?.quantity.amount ?? 0;
    row.toOrder = round(Math.max(0, row.needed - row.onHand));
    row.packages = Math.ceil(row.toOrder / row.packageSize - 1e-9);
    row.orderedAmount = round(row.packages * row.packageSize);
    row.costEurCents = row.packages * product.pricePerPackageEurCents;
    if (row.packages > 0) {
      if (product.unavailableReason) row.problem = product.unavailableReason;
      else if (product.availablePackages === 0) row.problem = "out of stock";
      else if (product.availablePackages < row.packages) {
        row.problem = `only ${product.availablePackages} packages in stock, ${row.packages} needed`;
        row.keepPackages = product.availablePackages;
      } else if (input.deliverBy && product.deliveryDate && product.deliveryDate > input.deliverBy) {
        row.problem = `delivers ${product.deliveryDate}, after the ${input.deliverBy} deadline`;
      }
      if (row.problem) problems.push(`${row.productName} (${row.dishes.join(", ")}): ${row.problem}.`);
    }
  }

  const orderable = [...rows.values()].filter((row) => row.packages > 0 && !row.problem);
  const { resolutions, extra } = substitute(store, input, rows, inventory);

  // Everything to order once the substitutions are accepted, merged per product and rounded up to whole packages.
  const toBuy = new Map<string, number>();
  for (const row of orderable) toBuy.set(row.productId, row.toOrder);
  // Partial availability: what Valio Aimo can deliver is kept, and only the rest is substituted.
  for (const row of rows.values()) if (row.keepPackages) toBuy.set(row.productId, round(row.keepPackages * row.packageSize));
  for (const [productId, amount] of extra) toBuy.set(productId, round((toBuy.get(productId) ?? 0) + amount));
  const linesWithSubstitutes = [...toBuy].map(([productId, amount]) => {
    const product = store.products.find((candidate) => candidate.id === productId)!;
    const packages = Math.ceil(amount / product.packageSize.amount - 1e-9);
    return { productId, quantity: { amount: packages, unit: "package" as const }, cost: packages * product.pricePerPackageEurCents };
  });
  const plan: MenuPlan = {
    id: `P-${String(store.nextPlanNumber++).padStart(4, "0")}`,
    createdAt: new Date().toISOString(),
    createdBy: { id: principal.id, role: principal.role, name: principal.name },
    agentId: input.agentId,
    dishes,
    ...(input.deliverBy ? { deliverBy: input.deliverBy } : {}),
    rows: [...rows.values()],
    totalEurCents: orderable.reduce((total, row) => total + row.costEurCents, 0),
    lines: orderable.map((row) => ({ productId: row.productId, quantity: { amount: row.packages, unit: "package" } })),
    problems,
    resolutions,
    linesWithSubstitutes: linesWithSubstitutes.map(({ productId, quantity }) => ({ productId, quantity })),
    totalWithSubstitutesEurCents: linesWithSubstitutes.reduce((total, line) => total + line.cost, 0),
  };
  store.plans.set(plan.id, plan);
  return plan;
}

/**
 * For every problem row, finds a substitute per dish, because the same product
 * plays different roles: crushed tomatoes can replace cherry tomatoes in a
 * sauce but not in a salad. Spare kitchen stock comes first, then the best
 * substitute that meets the kitchen's policy and the deadline.
 */
function substitute(
  store: Store,
  input: { agentId: string; deliverBy?: string },
  rows: Map<string, MenuPlanRow>,
  inventory: { productId: string; quantity: { amount: number } }[],
): { resolutions: string[]; extra: Map<string, number> } {
  const policy = store.policies.get(input.agentId);
  const spare = new Map<string, number>();
  for (const item of inventory) {
    spare.set(item.productId, round(item.quantity.amount - (rows.get(item.productId)?.needed ?? 0)));
  }
  const resolutions: string[] = [];
  const extra = new Map<string, number>();

  for (const row of rows.values()) {
    if (!row.problem) continue;
    // The kitchen's own stock, and what Valio Aimo can still deliver, go to the dishes in order; the rest is each dish's shortfall.
    const kept = round((row.keepPackages ?? 0) * row.packageSize);
    if (kept > 0) resolutions.push(`${row.productName}: keep the ${kept} ${row.unit === "litre" ? "L" : row.unit === "kilogram" ? "kg" : "pcs"} Valio Aimo can deliver, and substitute only the rest.`);
    let onHand = round(row.onHand + kept);
    row.substitutions = [];
    for (const use of row.uses) {
      const fromStock = Math.min(onHand, use.needed);
      onHand = round(onHand - fromStock);
      const shortfall = round(use.needed - fromStock);
      if (shortfall <= 0) continue;

      const result = findSubstitutes(
        store.products,
        {
          productId: row.productId,
          quantity: { amount: shortfall, unit: row.unit },
          requirements: input.deliverBy ? { deliverBy: input.deliverBy } : {},
          role: use.role,
        },
        policy,
      );
      const name = (productId: string) => store.products.find((product) => product.id === productId)?.name ?? productId;
      const ruledOut = result.excluded
        .filter((entry) => entry.reasons.some((reason) => reason.includes(use.role)))
        .map((entry) => ({ productId: entry.productId, productName: name(entry.productId), reason: entry.reasons.join("; ") }));

      const substitution: Substitution = { dish: use.dish, role: use.role, shortfall, unit: row.unit, note: "", ruledOut };
      // The kitchen's own spare stock needs no delivery, so the deadline does not apply to it.
      const anyDate = input.deliverBy
        ? findSubstitutes(store.products, { productId: row.productId, quantity: { amount: shortfall, unit: row.unit }, requirements: {}, role: use.role }, policy)
        : result;
      const inStock = anyDate.substitutes.find((candidate) => (spare.get(candidate.productId) ?? 0) >= shortfall - 1e-9 && candidate.quantity.unit === row.unit);
      const toOrder = result.substitutes[0];
      if (inStock) {
        spare.set(inStock.productId, round(spare.get(inStock.productId)! - shortfall));
        substitution.choice = {
          source: "stock",
          productId: inStock.productId,
          productName: inStock.productName,
          supplier: inStock.supplier,
          amount: shortfall,
          unit: row.unit,
        };
        const why = inStock.matchNotes.find((note) => note.startsWith("suits")) ?? inStock.matchNotes[0] ?? "a close match";
        substitution.note = `${amountText(shortfall, row.unit)} of ${inStock.productName} from the kitchen's spare stock, no order needed. It ${why.startsWith("suits") ? why : `is a close match: ${why}`}.`;
      } else if (toOrder) {
        const amount = toOrder.quantity.unit === row.unit ? shortfall : toOrder.quantity.amount;
        extra.set(toOrder.productId, round((extra.get(toOrder.productId) ?? 0) + amount));
        substitution.choice = {
          source: "order",
          productId: toOrder.productId,
          productName: toOrder.productName,
          supplier: toOrder.supplier,
          amount,
          unit: row.unit,
          ...(toOrder.deliveryDate ? { deliveryDate: toOrder.deliveryDate } : {}),
        };
        substitution.note = `Order ${toOrder.productName} from ${toOrder.supplier}, delivered ${toOrder.deliveryDate}. ${toOrder.tradeOff}`;
      } else {
        substitution.note = `No substitute suits a ${use.role} and arrives in time. Change the dish or ask the buyer.`;
      }
      row.substitutions.push(substitution);
      resolutions.push(`${use.dish}: ${row.productName} (${use.role}) → ${substitution.note}`);
    }
  }
  return { resolutions, extra };
}

/** One line for the buyer's log, for example "3 products to order for €438.40, 0 problems". */
export function describePlan(plan: MenuPlan): string {
  const toOrder = plan.rows.filter((row) => row.packages > 0).length;
  const substitutes =
    plan.resolutions.length > 0 ? ` ${plan.resolutions.length} substitutions, ${formatEur(plan.totalWithSubstitutesEurCents)} with them.` : "";
  return `${plan.id}: ${plan.dishes.map((dish) => `${dish.portions} × ${dish.name}`).join(", ")}. ${toOrder} products to order for ${formatEur(plan.totalEurCents)}, ${plan.problems.length} ${plan.problems.length === 1 ? "problem" : "problems"}.${substitutes}`;
}
