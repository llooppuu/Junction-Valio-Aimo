import { nextMonday, plannedOrders } from "../data/plannedOrders.js";
import { helsinkiDate } from "./dates.js";
import { liveProducts, substituteCandidates } from "./market.js";
import { recipes } from "../data/recipes.js";
import type { IngredientRole } from "../schemas/product.js";
import type { Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { formatEur } from "./permissions.js";
import { findSubstitutes, type Tier } from "./substitutes.js";
import { fiDate, fiEur } from "../i18n.js";

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
    productNameFi: string;
    supplier: string;
    packages: number;
    costEurCents: number;
    deliveryDate: string | null;
    tradeOff: string;
    tradeOffFi: string;
  };
  /** Products ruled out for this kitchen, with the reasons. */
  ruledOut: { productId: string; productName: string; reason: string }[];
  note: string;
  /** The note in Finnish. */
  noteFi: string;
}

export interface StockAlert {
  id: string;
  at: string;
  agentId: string;
  buyerName: string;
  productId: string;
  productName: string;
  productNameFi: string;
  supplier: string;
  /** For example "out of stock" or "only 1 package left, 2 on the next planned order". */
  problem: string;
  /** The problem in Finnish. */
  problemFi: string;
  affects: {
    dishes: { dish: string; role: IngredientRole }[];
    plannedOrder?: { name: string; deliveryDate: string; packages: number };
  };
  proposals: AlertProposal[];
  status: "open" | "resolved";
  resolvedAt?: string;
}

/** Valio Aimo's availability reasons in Finnish, as the interface's serverPhrase shows them. */
export function unavailableFi(reason: string): string {
  const date = /(\d{4})-(\d{2})-(\d{2})/.exec(reason);
  const shortDate = date ? `${Number(date[3])}.${Number(date[2])}.${date[1]}` : "";
  if (reason === "Valio Aimo cannot deliver it on any date") return "Valio Aimo ei voi toimittaa sitä millekään päivälle";
  if (reason === "Valio Aimo has blocked its sales for now") return "Valio Aimo on toistaiseksi estänyt sen myynnin";
  if (reason === "Valio Aimo has no price for it") return "Valio Aimolla ei ole sille hintaa";
  if (reason === "Valio Aimo did not report its availability") return "Valio Aimo ei ilmoittanut sen saatavuutta";
  if (reason.startsWith("none available")) return shortDate ? `ei saatavilla ${shortDate}` : "ei saatavilla";
  if (reason.startsWith("the order cut-off")) return `toimitukselle ${shortDate} tilausaika on päättynyt`;
  return reason;
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
          fi: { summary: `${open.id} ratkesi: toimittajalla ${product.supplier} on taas ${product.availablePackages} myyntierää tuotetta ${product.nameFi}.` },
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
    const problemFi = product.unavailableReason
      ? unavailableFi(product.unavailableReason)
      : product.availablePackages === 0
        ? "loppu varastosta"
        : `jäljellä vain ${product.availablePackages} myyntierää, seuraavassa tilauksessa ${needed}`;

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
                productNameFi: store.products.find((candidate) => candidate.id === best.productId)?.nameFi ?? best.productName,
                supplier: best.supplier,
                packages: best.packages,
                costEurCents: best.costEurCents,
                deliveryDate: best.deliveryDate,
                tradeOff: best.tradeOff,
                tradeOffFi: best.tradeOffFi,
              },
            }
          : {}),
        ruledOut: result.excluded.map((entry) => ({ productId: entry.productId, productName: name(entry.productId), reason: entry.reasons.join("; ") })),
        note: best
          ? `${best.productName} from ${best.supplier}${role ? ` for the ${role}` : ""}: ${best.tradeOff}`
          : `No substitute${role ? ` suits the ${role}` : ""} within this kitchen's rules${planned && line ? ` by ${planned.deliveryDate}` : ""}.`,
        noteFi: best
          ? `${store.products.find((candidate) => candidate.id === best.productId)?.nameFi ?? best.productName}, toimittaja ${best.supplier}: ${best.tradeOffFi}`
          : `Keittiön sääntöihin sopivaa korviketta ei löytynyt${planned && line ? ` toimitukselle ${fiDate(planned.deliveryDate)}` : ""}.`,
      };
    });

    const alert: StockAlert = {
      id: `AL-${String(store.nextAlertNumber++).padStart(4, "0")}`,
      at: store.clock().toISOString(),
      agentId,
      buyerName: policy.buyerName,
      productId,
      productName: product.name,
      productNameFi: product.nameFi,
      supplier: product.supplier,
      problem,
      problemFi,
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
    const affectedFi = [
      ...(dishes.length > 0 ? [`${dishes.length} ${dishes.length === 1 ? "ruokalaji" : "ruokalajia"}`] : []),
      ...(alert.affects.plannedOrder ? [`${alert.affects.plannedOrder.packages} myyntierää seuraavassa tilauksessa ${fiDate(planned!.deliveryDate)}`] : []),
    ].join("; ");
    recordAudit(store, agent, {
      action: "stock.alert",
      productId,
      summary: `${alert.id}: ${product.name} from ${product.supplier} is ${problem}. Affects ${affected}.`,
      reason: "Noticed by the agent's stock watch, without a request.",
      fi: {
        summary: `${alert.id}: ${product.nameFi} (${product.supplier}): ${problemFi}. Vaikuttaa: ${affectedFi}.`,
        reason: "Agentin saldovahti huomasi tämän ilman pyyntöä.",
      },
    });
    for (const proposal of proposals) {
      recordAudit(store, agent, {
        action: "substitute.proposed",
        ...(proposal.substitute ? { productId: proposal.substitute.productId } : { productId }),
        summary: `${alert.id}${proposal.dishes.length > 0 ? ` (${proposal.dishes.join(", ")})` : ""}: ${proposal.note}`,
        ...(proposal.substitute
          ? { reason: `Proposed only, nothing ordered. ${proposal.substitute.packages} packages for ${formatEur(proposal.substitute.costEurCents)}, delivered ${proposal.substitute.deliveryDate}.` }
          : {}),
        fi: {
          summary: `${alert.id}: ${proposal.noteFi}`,
          ...(proposal.substitute
            ? { reason: `Vain ehdotus, mitään ei tilattu. ${proposal.substitute.packages} myyntierää, ${fiEur(proposal.substitute.costEurCents)}, toimitus ${proposal.substitute.deliveryDate ? fiDate(proposal.substitute.deliveryDate) : "-"}.` }
            : {}),
        },
      });
    }
  }
  return raised;
}
