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

export interface SupplierReliability {
  name: string;
  productCount: number;
  leastReliable: { product: string; share: number };
  /** Share of ordered quantities delivered as ordered, 0 to 1. */
  share: number;
}
