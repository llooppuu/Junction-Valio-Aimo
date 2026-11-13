// Mirrors the backend schemas and services. Update both when the API changes.
// Requests go through the Vite proxy, which adds the buyer's demo token.
import { rememberProducts } from "./names";
export type PackageUnit = "litre" | "kilogram" | "piece";

/** Buyer categories, mapped by the server from Valio Aimo's category codes. */
export type ProductCategory =
  | "milk"
  | "cream"
  | "plant-based"
  | "yoghurt"
  | "desserts"
  | "fats"
  | "eggs"
  | "cheese"
  | "meat"
  | "fish"
  | "vegetables"
  | "fruit-berries"
  | "bakery"
  | "ready-meals"
  | "pantry"
  | "drinks"
  | "sweets-snacks"
  | "non-food"
  | "other";

export type Allergen =
  | "gluten"
  | "crustaceans"
  | "eggs"
  | "fish"
  | "peanuts"
  | "soy"
  | "milk"
  | "nuts"
  | "celery"
  | "mustard"
  | "sesame"
  | "sulphites"
  | "lupin"
  | "molluscs";

export type Label =
  | "eu-organic"
  | "msc"
  | "asc"
  | "fairtrade"
  | "rainforest-alliance"
  | "nordic-swan"
  | "eu-ecolabel"
  | "krav"
  | "finnish-origin"
  | "heart-symbol";

export interface Quantity {
  amount: number;
  unit: PackageUnit;
}

export interface Nutrition {
  per: "100ml" | "100g";
  energyKcal?: number;
  fatG?: number;
  saturatedFatG?: number;
  carbohydrateG?: number;
  sugarsG?: number;
  proteinG?: number;
  saltG?: number;
  calciumMg?: number;
}

export interface SignedOffer {
  token: string;
  issuedAt: string;
  expiresAt: string;
}

export type VerifyResult =
  | { valid: true; claims: Record<string, unknown> }
  | { valid: false; reason: string; claims?: Record<string, unknown> };

/** Asks the server to check a signed offer. Agents can do the same offline with the published key. */
export async function verifyOffer(token: string): Promise<VerifyResult> {
  return request<VerifyResult>("/api/offers/verify", { method: "POST", body: JSON.stringify({ token }) });
}

/** A supplier's delivery reliability from Valio Aimo's history: the average over its products with a record. */
export interface SupplierReliability {
  supplier: string;
  products: number;
  /** Share of ordered quantities delivered as ordered, 0 to 1. */
  reliability: number;
  lowest: { productId: string; name: string; reliability: number };
  riskLevel: "low" | "moderate" | "high";
  flagged: boolean;
}

export type StockStatus = "counted" | "plenty" | "unconfirmed" | "none";

/** A Valio Aimo product with the price and availability its APIs returned for the delivery date. */
export interface Product {
  id: string;
  gtin?: string;
  name: string;
  nameFi: string;
  brand?: string;
  supplier: string;
  categoryCode: string;
  category: ProductCategory;
  description: string;
  descriptionFi: string;
  /** The unit Valio Aimo sells it in, such as KI (case) or ST (piece). */
  salesUnit: string;
  lotSize: number;
  /** What one sales unit contains. */
  packageSize: Quantity;
  packageSizeSource: "comparison price" | "product name" | "unknown";
  /** Valio Aimo's price for one sales unit, without VAT. */
  pricePerPackageEurCents: number;
  vatRatePercent: number;
  comparisonPrice?: { eurCents: number; unit: "litre" | "kilogram" };
  customerPrice: boolean;
  availablePackages: number;
  stockStatus: StockStatus;
  /** Null when Valio Aimo does not limit the stock or cannot see it. */
  availableQuantity: Quantity | null;
  deliveryDate: string | null;
  orderCutoff: string | null;
  cutoffPassed: boolean;
  salesBlock: boolean;
  logisticModel: "stock" | "supplier" | "unknown";
  /** Share of ordered quantities delivered as ordered, from Valio Aimo's history. */
  deliveryReliability?: number;
  /** kg CO2e per kg, the average for the product's group. */
  co2PerKg?: number;
  attributes: string[];
  labels: Label[];
  origin: { country?: string };
  temperature?: "frozen" | "chilled" | "ambient";
  allergens: Allergen[];
  mayContain: Allergen[];
  /** Allergens the supplier claims the product is free from. */
  freeFrom: Allergen[];
  /** False when the manufacturer declared nothing about allergens. */
  allergensDeclared: boolean;
  /** The server's signed claim on this product, verifiable with the key at /.well-known/jwks.json. */
  offer: SignedOffer;
  /** The same allergens as GS1 statements, derived by the server. */
  allergenStatements: { allergenTypeCode: string; levelOfContainment: "CONTAINS" | "MAY_CONTAIN" | "FREE_FROM"; allergen: Allergen }[];
  nutrition?: Nutrition;
  substitutes: string[];
  /** Why it cannot be ordered for the date, when it cannot. */
  unavailableReason?: string;
  /** When Valio Aimo answered for this price and availability. */
  liveAt: string;
}

export type QuoteStatus =
  | "within_limit"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "out_of_date"
  | "ordered";

export interface QuoteLine {
  productId: string;
  productName: string;
  supplier: string;
  packages: number;
  quantity: Quantity;
  pricePerPackageEurCents: number;
  lineTotalEurCents: number;
  deliveryDate: string;
  salesUnit?: string;
  vatRatePercent?: number;
  orderCutoff?: string | null;
  stockStatus?: StockStatus;
}

export interface Quote {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  createdBy: { id: string; role: string; name: string };
  lines: QuoteLine[];
  totalEurCents: number;
  permission: {
    decision: "within_limit" | "needs_approval" | "created_by_buyer";
    limitEurCents: number | null;
    reason: string;
    checks: GuardrailCheck[];
  };
  deliveryDate: string;
  requirements?: { attributes?: string[]; deliverBy?: string };
  replacesQuoteId?: string;
  replacedBy?: string;
  buyerDecision?: { decision: "approve" | "reject"; by: { name: string }; at: string; note?: string };
  orderId?: string;
  /** Every comparable product when the quote was made, with the verdict and the reason. */
  alternatives?: Alternative[];
  /** The menu calculation this quote orders, when it came from a plan. */
  plan?: MenuPlan;
  /** For a standing order renewal: the comparison with recent weeks. */
  standingOrder?: StandingOrderReview;
  /** The wholesaler's suggestion this quote came from. */
  suggestionId?: string;
}

/** A new or seasonal product the wholesaler's sales agent suggested, as the buyer's agent screened it. */
export interface Suggestion {
  id: string;
  at: string;
  from: { id: string; role: string; name: string };
  agentId: string;
  buyerName: string;
  productId: string;
  productName: string;
  supplier: string;
  kind: "new" | "seasonal";
  pitch: string;
  pricePerPackageEurCents: number;
  status: "suggested" | "held_back" | "quoted" | "dismissed";
  screening: { suitable: boolean; reason: string; checks: GuardrailCheck[] };
  quoteId?: string;
}

export async function fetchSuggestions(signal?: AbortSignal): Promise<Suggestion[]> {
  const body = await request<{ suggestions: Suggestion[] }>("/api/suggestions", { signal: signal ?? null });
  return body.suggestions;
}

export async function dismissSuggestion(id: string): Promise<Suggestion> {
  const body = await request<{ suggestion: Suggestion }>(`/api/suggestions/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
  return body.suggestion;
}

/** Runs the wholesaler's sales agent. The proxy adds the wholesaler's token for this path. Returns how many it sent. */
export async function runSalesAgent(): Promise<number> {
  const body = await request<{ sent: number }>("/api/wholesaler/suggestions", { method: "POST" });
  return body.sent;
}

export async function fetchWholesalerSuggestions(signal?: AbortSignal): Promise<Suggestion[]> {
  const body = await request<{ suggestions: Suggestion[] }>("/api/wholesaler/suggestions", { signal: signal ?? null });
  return body.suggestions;
}

/** The buyer's signed authority for one agent, a W3C Verifiable Credential in JWT form. */
export interface Mandate {
  id: string;
  token: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  status: "active" | "superseded" | "revoked";
  revokedAt?: string;
  agentId: string;
  agentName: string;
  buyerName: string;
  spendingLimitEurCents: number;
  allowedCategories: ProductCategory[];
}

export interface MandateCheck {
  valid: boolean;
  reason?: string;
  status: Mandate["status"] | "unknown";
  issuedByBuyer: boolean;
}

export async function fetchMandates(signal?: AbortSignal): Promise<{ issuer: string; mandates: Mandate[] }> {
  return request("/api/mandates", { signal: signal ?? null });
}

/** Issues a new mandate for the agent with the policy's defaults, replacing the one in force. */
export async function issueMandate(agentId: string): Promise<Mandate> {
  const body = await request<{ mandate: Mandate }>("/api/mandates", { method: "POST", body: JSON.stringify({ agentId }) });
  return body.mandate;
}

export async function revokeMandate(id: string): Promise<Mandate> {
  const body = await request<{ mandate: Mandate }>(`/api/mandates/${encodeURIComponent(id)}/revoke`, { method: "POST" });
  return body.mandate;
}

/** Checks a mandate from the token alone, as any supplier or agent could. */
export async function verifyMandate(token: string): Promise<MandateCheck> {
  return request("/api/mandates/verify", { method: "POST", body: JSON.stringify({ token }) });
}

export interface Trend {
  history: number[];
  mean: number;
  spread: number;
  renewal: number;
  changePct: number;
  flagged: boolean;
}

/** A weekly standing order compared with its recent weeks before it renews. */
export interface StandingOrderReview {
  agentId: string;
  buyerName: string;
  name: string;
  deliveryDate: string;
  thresholdPct: number;
  weeks: string[];
  lines: (Trend & { productId: string; productName: string; packagePriceEurCents: number })[];
  cost: Trend;
  flagged: boolean;
  summary: string;
}

export async function fetchStandingOrders(signal?: AbortSignal): Promise<StandingOrderReview[]> {
  const body = await request<{ reviews: StandingOrderReview[] }>("/api/standing-orders", { signal: signal ?? null });
  return body.reviews;
}

export interface MenuPlan {
  id: string;
  agentId: string;
  dishes: { recipeId: string; name: string; portions: number }[];
  deliverBy?: string;
  rows: {
    productId: string;
    productName: string;
    supplier: string;
    unit: PackageUnit;
    dishes: string[];
    needed: number;
    onHand: number;
    toOrder: number;
    packageSize: number;
    packages: number;
    orderedAmount: number;
    costEurCents: number;
    deliveryDate: string;
    problem?: string;
    uses?: { dish: string; role: string; needed: number }[];
    substitutions?: Substitution[];
  }[];
  totalEurCents: number;
  problems: string[];
  resolutions?: string[];
  totalWithSubstitutesEurCents?: number;
}

/** How one dish's share of a problem ingredient is covered, chosen for the ingredient's role in that dish. */
export interface Substitution {
  dish: string;
  role: string;
  shortfall: number;
  unit: PackageUnit;
  choice?: {
    source: "stock" | "order";
    productId: string;
    productName: string;
    supplier: string;
    amount: number;
    unit: PackageUnit;
    deliveryDate?: string;
  };
  note: string;
  ruledOut: { productId: string; productName: string; reason: string }[];
}

export interface Alternative {
  productId: string;
  productName: string;
  supplier: string;
  verdict: "chosen" | "not_chosen" | "excluded";
  reason: string;
}

export interface WholesalerActivity {
  agents: {
    agentId: string;
    agentName: string;
    buyerName: string;
    quotes: number;
    withinLimit: number;
    waitingForApproval: number;
    approved: number;
    rejected: number;
    orders: number;
    orderValueEurCents: number;
    blocked: number;
    refused: number;
    accessDenied: number;
    toolRefused: number;
  }[];
  waiting: { quoteId: string; agentName: string; buyerName: string | null; totalEurCents: number; reason: string }[];
  attention: (AuditEntry & { buyerName: string | null })[];
  entries: (AuditEntry & { buyerName: string | null })[];
}

/** The wholesaler's view. The proxy adds the wholesaler's token for this path, so it never reaches the browser. */
export async function fetchWholesalerActivity(signal?: AbortSignal): Promise<WholesalerActivity> {
  return request<WholesalerActivity>("/api/wholesaler/activity", { signal: signal ?? null });
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string; role: string; name: string };
  action: string;
  summary: string;
  reason?: string;
  quoteId?: string;
  relatedQuoteId?: string;
  orderId?: string;
  productId?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
  });

  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;

  if (!response.ok) {
    throw new Error(body?.error ?? `The server responded with status ${response.status}.`);
  }
  if (body === undefined) {
    throw new Error("The server response was not valid JSON.");
  }
  return body;
}

export interface Order {
  id: string;
  quoteId: string;
  placedAt: string;
  placedBy: { id: string; role: string; name: string };
  lines: QuoteLine[];
  totalEurCents: number;
  deliveryDate: string;
}

export interface Policy {
  agentId: string;
  agentName: string;
  buyerName: string;
  spendingLimitEurCents: number;
  /** The most the agent may commit on its own in one day, across all its quotes. */
  dailyLimitEurCents: number;
  excludedAllergens: Allergen[];
  preferredSuppliers: string[];
  requiredLabels: Label[];
  requiredAttributes: Partial<Record<ProductCategory, string[]>>;
  nutritionMinimums: Partial<Record<ProductCategory, { calciumMg?: number; proteinG?: number; appliesTo?: string[] }>>;
}

export interface GuardrailCheck {
  rule:
    | "spending_limit"
    | "daily_limit"
    | "allergens"
    | "preferred_suppliers"
    | "required_labels"
    | "required_attributes"
    | "nutrition"
    | "standing_order_drift"
    | "wholesaler_suggestion";
  outcome: "passed" | "needs_approval" | "blocked";
  detail: string;
}

export async function fetchOrders(signal?: AbortSignal): Promise<Order[]> {
  const body = await request<{ orders: Order[] }>("/api/orders", { signal: signal ?? null });
  return body.orders;
}

export async function fetchSuppliers(signal?: AbortSignal): Promise<{ formula: string; suppliers: SupplierReliability[] }> {
  return request<{ formula: string; suppliers: SupplierReliability[] }>("/api/suppliers", { signal: signal ?? null });
}

/** Raised by a kitchen's agent on its own when a supplier can no longer cover a recipe or the next planned order. */
export interface StockAlert {
  id: string;
  at: string;
  agentId: string;
  buyerName: string;
  productId: string;
  productName: string;
  supplier: string;
  problem: string;
  affects: {
    dishes: { dish: string; role: string }[];
    plannedOrder?: { name: string; deliveryDate: string; packages: number };
  };
  proposals: {
    role?: string;
    dishes: string[];
    substitute?: {
      tier: string;
      productId: string;
      productName: string;
      supplier: string;
      packages: number;
      costEurCents: number;
      deliveryDate: string;
      tradeOff: string;
    };
    ruledOut: { productId: string; productName: string; reason: string }[];
    note: string;
  }[];
  status: "open" | "resolved";
  resolvedAt?: string;
}

export async function fetchAlerts(signal?: AbortSignal): Promise<StockAlert[]> {
  const body = await request<{ alerts: StockAlert[] }>("/api/alerts", { signal: signal ?? null });
  return body.alerts;
}

export async function fetchPolicies(signal?: AbortSignal): Promise<Policy[]> {
  const body = await request<{ policies: Policy[] }>("/api/policy", { signal: signal ?? null });
  return body.policies;
}

type Query = Record<string, string | string[] | undefined>;

/** The catalog search the agents use. Empty parameters are left out. */
export function productSearchPath(query: Query = {}, base = "/api/products"): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const text = Array.isArray(value) ? value.join(",") : value;
    if (text) params.set(key, text);
  }
  return params.size > 0 ? `${base}?${params.toString().replaceAll("%2C", ",")}` : base;
}

export type RankBy = "price" | "delivery" | "reliability" | "labels" | "carbon";

export interface RankedOffer {
  rank: number;
  product: Product;
  unitPriceEurCents: number;
  reason: string;
}

export interface SubstitutesResult {
  policy: { agentId: string; buyerName: string } | null;
  /** Set when nothing qualifies: what to do instead. */
  nextStep?: string;
  requested: { productId: string; packages: number; quantity: Quantity; unmet: string[] };
  substitutes: {
    tier: "best" | "better" | "good";
    productId: string;
    productName: string;
    supplier: string;
    packages: number;
    quantity: Quantity;
    costEurCents: number;
    deliveryDate: string;
    matchScore: number;
    matchNotes: string[];
    tradeOff: string;
    /** Each part of the server's ranking, 0 to 100, and the weighted total that set the tier. */
    scores: { similarity: number; price: number; preference: number; availability: number; combined: number };
    scoreNotes: { price: string; preference: string; availability: string };
  }[];
  excluded: { productId: string; supplier: string; reasons: string[] }[];
}

/** Good, better, and best substitutes for a product that cannot fill a request. */
export async function fetchSubstitutes(productId: string, packages: number): Promise<SubstitutesResult> {
  return request<SubstitutesResult>(
    `/api/substitutes?productId=${encodeURIComponent(productId)}&amount=${packages}&unit=package`,
  );
}

/** Matching offers ranked by what the buyer cares about, each with a plain-language reason. */
export interface OffersResult {
  offers: RankedOffer[];
  /** Matches Valio Aimo cannot deliver for the date, with the reason. */
  unavailable: { productId: string; name: string; reason: string }[];
}

export async function fetchOffers(signal: AbortSignal | undefined, query: Query): Promise<RankedOffer[]> {
  return (await fetchOfferResult(signal, query)).offers;
}

export async function fetchOfferResult(signal: AbortSignal | undefined, query: Query): Promise<OffersResult> {
  const body = await request<OffersResult>(productSearchPath(query, "/api/offers"), { signal: signal ?? null });
  rememberProducts(body.offers.map((offer) => offer.product));
  return body;
}

/** A catalog search: the matches with live data, the ones that fail on live data with the reason, and the source. */
export interface ProductSearchResult {
  products: Product[];
  excluded: { productId: string; name: string; reasons: string[] }[];
  source: { system: string; answeredAt: string | null; productsQueried: number };
}

/** One product with Valio Aimo's live price and availability. */
export async function fetchProduct(id: string, signal?: AbortSignal): Promise<Product> {
  const body = await request<{ product: Product }>(`/api/products/${encodeURIComponent(id)}`, { signal: signal ?? null });
  rememberProducts([body.product]);
  return body.product;
}

export async function searchProducts(signal: AbortSignal | undefined, query: Query): Promise<ProductSearchResult> {
  const body = await request<ProductSearchResult>(productSearchPath(query), { signal: signal ?? null });
  rememberProducts(body.products);
  return body;
}

export async function fetchProducts(
  signal?: AbortSignal,
  query: Record<string, string | string[] | undefined> = {},
): Promise<Product[]> {
  const body = await request<{ products?: unknown }>(productSearchPath(query), { signal: signal ?? null });
  if (!Array.isArray(body.products)) {
    throw new Error("The server response did not include a product list.");
  }
  rememberProducts(body.products as Product[]);
  return body.products as Product[];
}

export async function fetchQuotes(signal?: AbortSignal): Promise<Quote[]> {
  const body = await request<{ quotes: Quote[] }>("/api/quotes", { signal: signal ?? null });
  return body.quotes;
}

/** Recent activity across all quotes, newest first. */
export async function fetchAudit(signal?: AbortSignal): Promise<AuditEntry[]> {
  const body = await request<{ entries: AuditEntry[] }>("/api/audit?limit=50", { signal: signal ?? null });
  return body.entries;
}

/** One quote's history, oldest first. */
export async function fetchQuoteAudit(quoteId: string, signal?: AbortSignal): Promise<AuditEntry[]> {
  const body = await request<{ entries: AuditEntry[] }>(
    `/api/quotes/${encodeURIComponent(quoteId)}/audit`,
    { signal: signal ?? null },
  );
  return body.entries;
}

export interface AgentStatus {
  available: boolean;
  model: string | null;
}

export type AgentStep =
  | { index: number; at: string; kind: "message"; text: string }
  | {
      index: number;
      at: string;
      kind: "tool_call";
      tool: string;
      arguments: unknown;
      method: string;
      path: string;
      httpStatus: number;
      ok: boolean;
      summary: string;
      quoteId?: string;
      orderId?: string;
      /** For calls that produced or refused a quote: the server's decision and every rule it checked. */
      permission?: { decision: string; reason: string; checks: GuardrailCheck[] };
      /** For a menu plan: the server's calculation. */
      plan?: MenuPlan;
    };

export type AgentOutcome = "awaiting_approval" | "quote_ready" | "ordered" | "needs_attention" | "answered";

export interface AgentRun {
  id: string;
  conversationId: string;
  model: string;
  agent: { id: string; name: string };
  request: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  steps: AgentStep[];
  reply?: string;
  outcome?: AgentOutcome;
  quote?: { id: string; status: QuoteStatus; totalEurCents: number };
  error?: string;
}

export async function fetchAgentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  return request<AgentStatus>("/api/agent", { signal: signal ?? null });
}

/** Hands a request to the AI agent. The run starts at once and is followed with fetchAgentRun. */
export async function startAgentRun(
  message: string,
  conversationId: string | undefined,
  agentId: string,
  language: "en" | "fi" = "en",
): Promise<AgentRun> {
  const body = await request<{ run: AgentRun }>("/api/agent/runs", {
    method: "POST",
    // A follow-up keeps its conversation's agent, so only a new conversation names one. The agent replies in the buyer's language.
    body: JSON.stringify(conversationId ? { message, conversationId, language } : { message, agentId, language }),
  });
  return body.run;
}

/** All runs, newest first. */
export async function fetchAgentRuns(signal?: AbortSignal): Promise<AgentRun[]> {
  const body = await request<{ runs: AgentRun[] }>("/api/agent/runs", { signal: signal ?? null });
  return body.runs;
}

export async function fetchAgentRun(id: string, signal?: AbortSignal): Promise<AgentRun> {
  const body = await request<{ run: AgentRun }>(`/api/agent/runs/${encodeURIComponent(id)}`, {
    signal: signal ?? null,
  });
  return body.run;
}

/** Demo control: simulates a supplier's stock changing. */
/** Demo control: restores the catalog and clears quotes, orders, and agent runs. */
export async function resetDemo(): Promise<void> {
  await request<{ reset: boolean }>("/api/demo/reset", { method: "POST" });
}

export async function decideQuote(id: string, decision: "approve" | "reject"): Promise<Quote> {
  const body = await request<{ quote: Quote }>(`/api/quotes/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
  return body.quote;
}
