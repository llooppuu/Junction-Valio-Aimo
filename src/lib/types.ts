/** Shared data types for the sample data and the views. */

export type KitchenId = 'hotel' | 'school';

/** waiting: needs the buyer; ordered: placed by the agent within its rules. */
export type QuoteStatus = 'waiting' | 'approved' | 'rejected' | 'ordered';

export interface Quote {
  id: string;
  kitchenId: KitchenId;
  summary: string;
  quantity: string;
  total: number;
  delivery: string;
  status: QuoteStatus;
  /** True when the quote was within the agent's rules and needed no approval. */
  withinRules: boolean;
  /** Why the quote needs approval. */
  reason?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  quoteId: string;
  kitchenId: KitchenId;
  summary: string;
  total: number;
  placedAt: string;
  deliveryDate: string;
}

export interface AgentRun {
  id: string;
  kitchenId: KitchenId;
  request: string;
  startedAt: string;
}

export interface Mandate {
  id: string;
  categories: string;
  validUntil: string;
  signer: string;
}

export interface Kitchen {
  id: KitchenId;
  name: string;
  agentName: string;
  /** Largest quote the agent may order without the buyer's approval, in euros. */
  spendingLimit: number;
  rules: {
    blocked: string[];
    needsApproval: string[];
  };
  mandate: Mandate;
}

export interface StockAlert {
  id: string;
  kitchenId: KitchenId;
  product: string;
  supplier: string;
  problem: string;
  /** Where the product is used and how much is on order. */
  usage: string;
  proposal: {
    role: string;
    product: string;
    supplier: string;
    quantity: number;
    total: number;
    delivery: string;
    /** Positive when the substitute costs more than the requested product. */
    priceDelta: number;
    note?: string;
  };
}

export interface StandingOrderLine {
  product: string;
  /** Quantities ordered in each of the last weeks, oldest first. */
  history: number[];
  renewal: number;
  unitPrice: number;
}

export interface StandingOrder {
  kitchenId: KitchenId;
  title: string;
  deliveryDate: string;
  /** Share a line or the total may drift from the average before approval is needed. */
  driftLimit: number;
  lines: StandingOrderLine[];
}

export type ActivityKind =
  | 'alert'
  | 'proposal'
  | 'quote'
  | 'order'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'refused'
  | 'denied'
  | 'reply'
  | 'mandate';

export interface ActivityEntry {
  id: string;
  /** Local time, HH:MM:SS. */
  time: string;
  kitchenId: KitchenId;
  /** Who acted: the kitchen's agent or the buyer. */
  actor: 'agent' | 'buyer';
  kind: ActivityKind;
  /** Quote or alert the entry belongs to, such as "AL-0001" or "Q-0002". */
  ref?: string;
  text: string;
  detail: string;
}

export interface ExamplePrompt {
  eyebrow: string;
  text: string;
  hint: string;
}

/** One API call the agent makes during a run. */
export interface RunStep {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  summary: string;
}

export interface SupplierReliability {
  name: string;
  productCount: number;
  leastReliable: { product: string; share: number };
  /** Share of ordered quantities delivered as ordered, 0 to 1. */
  share: number;
}
