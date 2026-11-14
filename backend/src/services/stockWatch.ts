import { nextMonday, plannedOrders } from "../data/plannedOrders.js";
import { helsinkiDate } from "./dates.js";
import { liveProducts, substituteCandidates } from "./market.js";
import { recipes } from "../data/recipes.js";
import type { IngredientRole } from "../schemas/product.js";
import type { Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { formatEur } from "./permissions.js";
import { findSubstitutes, type Tier } from "./substitutes.js";

/**
 * The agent's stock watch. Whenever a supplier's stock changes, it checks
 * every kitchen that depends on the product, through a recipe or its next
 * planned order. If the stock no longer covers that need, it raises an alert
 * without being asked, with a substitute for each role the product plays, and
 * records both in the audit history. Nothing is ordered: the buyer decides.
 */

export interface AlertProposal {
  role?: IngredientRole;
  /** The dishes where the product plays this role. */
  dishes: string[];
  substitute?: {
    tier: Tier;
    productId: string;
    productName: string;
    supplier: string;
    packages: number;
    costEurCents: number;
    deliveryDate: string | null;
    tradeOff: string;
  };
  /** Products ruled out for this kitchen, with the reasons. */
  ruledOut: { productId: string; productName: string; reason: string }[];
  note: string;
}

export interface StockAlert {
  id: string;
  at: string;
  agentId: string;
  buyerName: string;
  productId: string;
  productName: string;
  supplier: string;
  /** For example "out of stock" or "only 1 package left, 2 on the next planned order". */
  problem: string;
  affects: {
    dishes: { dish: string; role: IngredientRole }[];
    plannedOrder?: { name: string; deliveryDate: string; packages: number };
  };
  proposals: AlertProposal[];
  status: "open" | "resolved";
  resolvedAt?: string;
}

/** Every product a kitchen's recipes or next planned order depend on. */
export function watchedProducts(store: Store): string[] {
  const today = helsinkiDate(store.clock());
  return [...new Set([...plannedOrders(today).flatMap((order) => order.lines.map((line) => line.productId)), ...recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.productId))])];
}

/**
 * Asks Valio Aimo about every product the kitchens depend on, for the next
 * planned delivery, and raises or resolves alerts. Substitute candidates get
 * live data only for products that are short.
 */
export async function refreshStockWatch(store: Store): Promise<StockAlert[]> {
  const deliveryDate = nextMonday(helsinkiDate(store.clock()));
  const watched = await liveProducts(store, watchedProducts(store), deliveryDate);
  const short = watched.filter((product) => product.unavailableReason || product.stockStatus === "counted");
  // Each kitchen's excluded allergens narrow the candidates it could use.
  const candidates = short.flatMap((product) =>
    [...store.policies.values()].flatMap((policy) => substituteCandidates(store, product.id, 30, { excludeAllergens: policy.excludedAllergens, processed: true }).map((entry) => entry.id)),
  );
  if (candidates.length > 0) await liveProducts(store, candidates, deliveryDate);
  return watched.flatMap((product) => watchStock(store, product.id));
}

/** Checks every kitchen against a product's current stock. Returns the alerts it raised. */
export function watchStock(store: Store, productId: string): StockAlert[] {
  const product = store.products.find((candidate) => candidate.id === productId);
  if (!product) return [];
  const raised: StockAlert[] = [];

  for (const policy of store.policies.values()) {
    const agentId = policy.agentId;
    const agent = store.principals.find((principal) => principal.id === agentId);
    if (!agent) continue;
    const dishes = recipes
      .filter((recipe) => recipe.kitchens.includes(agentId as never))
      .flatMap((recipe) =>
        recipe.ingredients.filter((ingredient) => ingredient.productId === productId).map((ingredient) => ({ dish: recipe.name, role: ingredient.role })),
      );
    const planned = plannedOrders(helsinkiDate(store.clock())).find((order) => order.agentId === agentId);
    const line = planned?.lines.find((candidate) => candidate.productId === productId);
    if (dishes.length === 0 && !line) continue;

    const needed = line?.packages ?? 1;
    const short = product.availablePackages < needed;
    const open = store.alerts.find((alert) => alert.status === "open" && alert.agentId === agentId && alert.productId === productId);

    if (!short) {
      if (open) {
        open.status = "resolved";
        open.resolvedAt = store.clock().toISOString();
        recordAudit(store, agent, {
          action: "stock.alert_resolved",
          productId,
          summary: `${open.id} resolved: ${product.supplier} has ${product.availablePackages} packages of ${product.name} again.`,
        });
      }
      continue;
    }
    if (open) continue;

    const problem = product.unavailableReason
      ? product.unavailableReason
      : product.availablePackages === 0
        ? "out of stock"
        : `only ${product.availablePackages} ${product.availablePackages === 1 ? "package" : "packages"} left, ${needed} on the next planned order`;

    // One proposal per role, because the right substitute depends on what the product does in the dish.
    const roles: (IngredientRole | undefined)[] = dishes.length > 0 ? [...new Set(dishes.map((dish) => dish.role))] : [undefined];
    const proposals = roles.map((role): AlertProposal => {
      const result = findSubstitutes(
        store.products,
        {
          productId,
          quantity: { amount: needed, unit: "package" },
          requirements: planned && line ? { deliverBy: planned.deliveryDate } : {},
          role,
        },
        policy,
      );
      const name = (id: string) => store.products.find((candidate) => candidate.id === id)?.name ?? id;
      const best = result.substitutes[0];
      const forDishes = dishes.filter((dish) => dish.role === role).map((dish) => dish.dish);
      return {
        ...(role ? { role } : {}),
        dishes: forDishes,
        ...(best
          ? {
              substitute: {
                tier: best.tier,
                productId: best.productId,
                productName: best.productName,
                supplier: best.supplier,
                packages: best.packages,
                costEurCents: best.costEurCents,
                deliveryDate: best.deliveryDate,
                tradeOff: best.tradeOff,
              },
            }
          : {}),
        ruledOut: result.excluded.map((entry) => ({ productId: entry.productId, productName: name(entry.productId), reason: entry.reasons.join("; ") })),
        note: best
          ? `${best.productName} from ${best.supplier}${role ? ` for the ${role}` : ""}: ${best.tradeOff}`
          : `No substitute${role ? ` suits the ${role}` : ""} within this kitchen's rules${planned && line ? ` by ${planned.deliveryDate}` : ""}.`,
      };
    });

    const alert: StockAlert = {
      id: `AL-${String(store.nextAlertNumber++).padStart(4, "0")}`,
      at: store.clock().toISOString(),
      agentId,
      buyerName: policy.buyerName,
      productId,
      productName: product.name,
      supplier: product.supplier,
      problem,
      affects: {
        dishes,
        ...(planned && line ? { plannedOrder: { name: planned.name, deliveryDate: planned.deliveryDate, packages: line.packages } } : {}),
      },
      proposals,
      status: "open",
    };
    store.alerts.push(alert);
    raised.push(alert);

    const affected = [
      ...(dishes.length > 0 ? [dishes.map((dish) => dish.dish).join(", ")] : []),
      ...(alert.affects.plannedOrder ? [`${alert.affects.plannedOrder.packages} on the ${planned!.name.toLowerCase()} for ${planned!.deliveryDate}`] : []),
    ].join("; ");
    recordAudit(store, agent, {
      action: "stock.alert",
      productId,
      summary: `${alert.id}: ${product.name} from ${product.supplier} is ${problem}. Affects ${affected}.`,
      reason: "Noticed by the agent's stock watch, without a request.",
    });
    for (const proposal of proposals) {
      recordAudit(store, agent, {
        action: "substitute.proposed",
        ...(proposal.substitute ? { productId: proposal.substitute.productId } : { productId }),
        summary: `${alert.id}${proposal.dishes.length > 0 ? ` (${proposal.dishes.join(", ")})` : ""}: ${proposal.note}`,
        ...(proposal.substitute
          ? { reason: `Proposed only, nothing ordered. ${proposal.substitute.packages} packages for ${formatEur(proposal.substitute.costEurCents)}, delivered ${proposal.substitute.deliveryDate}.` }
          : {}),
      });
    }
  }
  return raised;
}
