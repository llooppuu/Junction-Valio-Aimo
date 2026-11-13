/** Shared data types for the sample data and the views. */

export type KitchenId = 'hotel' | 'school';

export type QuoteStatus = 'within-rules' | 'waiting' | 'approved' | 'rejected' | 'ordered';

export interface Quote {
  id: string;
  kitchenId: KitchenId;
  summary: string;
  total: number;
  status: QuoteStatus;
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

export interface SupplierReliability {
  name: string;
  productCount: number;
  leastReliable: { product: string; share: number };
  /** Share of ordered quantities delivered as ordered, 0 to 1. */
  share: number;
}
