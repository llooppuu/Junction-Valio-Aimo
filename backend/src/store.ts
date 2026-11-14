import { createAgentState } from "./agent/runner.js";
import type { Principal } from "./auth.js";
import { config } from "./config.js";
import { loadCatalog, type CatalogEntry } from "./data/catalog.js";
import { createHttpValio, ValioUnavailableError, type ValioClient } from "./services/valio.js";
import { initialInventory } from "./data/recipes.js";
import type { InventoryItem } from "./schemas/recipe.js";
import type { MenuPlan } from "./services/menuPlan.js";
import type { Product } from "./schemas/product.js";
import type { AuditEntry } from "./services/audit.js";
import type { Order } from "./services/orders.js";
import type { AgentPolicy } from "./services/permissions.js";
import type { Quote } from "./services/quotes.js";
import type { StockAlert } from "./services/stockWatch.js";
import type { Suggestion } from "./services/suggestions.js";
import { productCategorySchema } from "./schemas/product.js";
import { buyerDid, issueMandate, type Mandate } from "./services/mandates.js";
import type { AutonomySettings } from "./services/autonomy.js";
import { seededTrackRecords } from "./data/trackRecord.js";

/** The demo agent's limit: €1,400.00, so €1,390.00 passes and €1,454.00 needs approval. */
export const DEMO_SPENDING_LIMIT_EUR_CENTS = 140000;

/** The school kitchen agent's limit: €500.00. */
export const SCHOOL_SPENDING_LIMIT_EUR_CENTS = 50000;

export interface StoreOptions {
  /** Valio Aimo's static product data. Defaults to the catalog built by `npm run data`. */
  catalog?: CatalogEntry[];
  /** Valio Aimo's price and availability. Defaults to the live mock APIs. */
  valio?: ValioClient;
  /** The current time. Tests fix it, so cut-off times compare the same on every run. */
  clock?: () => Date;
  spendingLimitEurCents?: number;
  /** Overrides parts of the demo agent's policy, for tests. */
  policy?: Partial<Omit<AgentPolicy, "agentId" | "agentName">>;
  /**
   * "earned" (the default): agents start supervised and earn autonomy per category.
   * "limits": agents order alone within their other rules. Tests of a single rule use it.
   */
  autonomy?: AutonomySettings["mode"];
}

function initialState(_options: StoreOptions) {
  return {
    /** Each agent's track record per product category, from which it earns autonomy. A demo reset restores it. */
    trackRecords: seededTrackRecords(),
    /** Products with live price and availability, fetched from Valio Aimo for what agents and buyers looked up. */
    products: [] as Product[],
    /** Sales units ordered here per product. The mock APIs take no orders, so these are subtracted from the stock Valio Aimo reports. */
    reservations: new Map<string, number>(),
    quotes: new Map<string, Quote>(),
    nextQuoteNumber: 1,
    orders: new Map<string, Order>(),
    nextOrderNumber: 1,
    audit: [] as AuditEntry[],
    agent: createAgentState(),
    /** Each kitchen's stock on hand, by its agent's ID. A demo reset restores it. */
    inventory: structuredClone(initialInventory) as Record<string, InventoryItem[]>,
    plans: new Map<string, MenuPlan>(),
    nextPlanNumber: 1,
    /** Raised by the agent's stock watch when a supplier can no longer cover what a kitchen depends on. */
    alerts: [] as StockAlert[],
    nextAlertNumber: 1,
    /** The wholesaler's suggestions to each buyer's agent, with the screening result. */
    suggestions: [] as Suggestion[],
    nextSuggestionNumber: 1,
  };
}

/**
 * All mutable state, held in memory. Each app instance gets its own store,
 * so tests never share state.
 */
export function createStore(options: StoreOptions = {}) {
  const agent: Principal = {
    id: "demo-agent",
    role: "agent",
    name: "Hotel chain purchasing agent",
    token: config.AGENT_TOKEN,
  };
  const schoolAgent: Principal = {
    id: "school-agent",
    role: "agent",
    name: "School kitchen purchasing agent",
    token: config.SCHOOL_AGENT_TOKEN,
  };
  const principals: Principal[] = [
    agent,
    schoolAgent,
    { id: "demo-buyer", role: "buyer", name: "Head chef", token: config.BUYER_TOKEN },
    { id: "wholesaler", role: "wholesaler", name: "Wholesaler operations", token: config.WHOLESALER_TOKEN },
  ];

  // Policies are set here on the server. No endpoint can change them.
  const policies = new Map<string, AgentPolicy>([
    [
      agent.id,
      {
        agentId: agent.id,
        agentName: agent.name,
        buyerName: "Hotel chain",
        spendingLimitEurCents: options.spendingLimitEurCents ?? DEMO_SPENDING_LIMIT_EUR_CENTS,
        // Splitting a purchase into smaller quotes does not get around the limit.
        dailyLimitEurCents: options.spendingLimitEurCents ?? DEMO_SPENDING_LIMIT_EUR_CENTS,
        // The hotel kitchens are nut-free and serve lactose-free milk.
        excludedAllergens: ["peanuts", "nuts"],
        preferredSuppliers: [],
        requiredLabels: [],
        requiredAttributes: { milk: ["lactose-free"] },
        nutritionMinimums: {},
        autonomy: { mode: options.autonomy ?? "earned", approvalsToEarn: 3 },
        ...options.policy,
      },
    ],
    [
      schoolAgent.id,
      {
        agentId: schoolAgent.id,
        agentName: schoolAgent.name,
        buyerName: "School kitchen",
        spendingLimitEurCents: SCHOOL_SPENDING_LIMIT_EUR_CENTS,
        dailyLimitEurCents: SCHOOL_SPENDING_LIMIT_EUR_CENTS,
        // Pupils with milk allergy: no milk protein at all, so lactose-free milk is excluded too.
        excludedAllergens: ["milk"],
        preferredSuppliers: [],
        requiredLabels: [],
        requiredAttributes: {},
        // A milk alternative for children must be fortified with calcium.
        nutritionMinimums: { "plant-based": { calciumMg: 100, appliesTo: ["drink", "juoma"] } },
        // Children's allergies: the school agent needs a longer run of approvals before it acts alone.
        autonomy: { mode: options.autonomy ?? "earned", approvalsToEarn: 5 },
      },
    ],
  ]);

  const entries = options.catalog ?? defaultCatalog();
  const catalog = { entries, byId: new Map(entries.map((entry) => [entry.id, entry])) };
  const valio = options.valio ?? defaultValio();
  const clock = options.clock ?? (() => new Date());

  return { options, principals, policies, catalog, valio, clock, ...initialState(options), ...initialMandates(policies) };
}

let sharedCatalog: CatalogEntry[] | undefined;
/** The built catalog, loaded once per process. */
function defaultCatalog(): CatalogEntry[] {
  return (sharedCatalog ??= loadCatalog());
}

let sharedValio: ValioClient | undefined;
/** One client per process, so its cache and call counts cover every request. */
function defaultValio(): ValioClient {
  if (sharedValio) return sharedValio;
  const apiKey = config.VALIO_API_KEY;
  sharedValio = apiKey
    ? createHttpValio({ apiKey, baseUrl: config.VALIO_API_URL })
    : {
        stats: { calls: 0, productsRequested: 0, cacheHits: 0, failures: 0, rateLimited: 0 },
        lookup: () => Promise.reject(new ValioUnavailableError("VALIO_API_KEY is not set")),
      };
  return sharedValio;
}

/** How long a mandate the buyer issues is valid, unless the buyer says otherwise. */
export const MANDATE_VALID_DAYS = 90;

/**
 * The buyer's starting mandate for each agent: every category, up to the
 * agent's policy limit. A demo reset issues fresh ones.
 */
function initialMandates(policies: Map<string, AgentPolicy>) {
  const mandates: Mandate[] = [...policies.values()].map((policy, index) =>
    issueMandate(
      `M-${String(index + 1).padStart(4, "0")}`,
      {
        agentId: policy.agentId,
        agentName: policy.agentName,
        buyerName: policy.buyerName,
        spendingLimitEurCents: policy.spendingLimitEurCents,
        allowedCategories: [...productCategorySchema.options],
      },
      MANDATE_VALID_DAYS,
    ),
  );
  return { mandates, nextMandateNumber: mandates.length + 1, buyerIssuer: buyerDid() };
}

export type Store = ReturnType<typeof createStore>;

/** Clears all purchasing activity and live data, for demo resets. */
export function resetStore(store: Store) {
  Object.assign(store, initialState(store.options), initialMandates(store.policies));
}

export function findProduct(store: Store, id: string): Product | undefined {
  return store.products.find((product) => product.id === id);
}
