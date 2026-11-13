/**
 * Sample data for the whole app. There is no backend: every view reads from
 * here, and changes made in the UI live only in memory.
 */
import type { AgentRun, Order, Quote, SupplierReliability } from '../lib/types.ts';

/** Language model shown next to the agents. */
export const AGENT_MODEL = 'gpt-5.5';

/** Wholesaler whose catalog and delivery history the agents use. */
export const WHOLESALER_NAME = 'Valio Aimo';

// ---------------------------------------------------------------------------
// Quotes, orders and agent runs (empty at the start of the demo)
// ---------------------------------------------------------------------------

export const quotes: Quote[] = [];

export const orders: Order[] = [];

export const agentRuns: AgentRun[] = [];

// ---------------------------------------------------------------------------
// Supplier reliability, from the wholesaler's delivery history
// ---------------------------------------------------------------------------

/** Suppliers below this share are flagged as a moderate delivery risk. */
export const RELIABILITY_WATCH_THRESHOLD = 0.95;

export const supplierReliability: SupplierReliability[] = [
  {
    name: 'RAVINTORAISIO OY KUIVA',
    productCount: 26,
    leastReliable: { product: '6 x Elovena 10x30g oat-cinnamon snack biscuit 100% oats', share: 0 },
    share: 0.934,
  },
  {
    name: 'FRESH SERVANT OY AB',
    productCount: 26,
    leastReliable: { product: 'Fresh SK Broccoli bud 1,0 kg', share: 0.5 },
    share: 0.943,
  },
  {
    name: 'MIDSONA FINLAND OY',
    productCount: 58,
    leastReliable: { product: '2x URTEKRAM Organic Sundried dates without pits 2,5kg', share: 0 },
    share: 0.951,
  },
  {
    name: 'PNM CHIPSTERS OY TEOLLINEN',
    productCount: 33,
    leastReliable: { product: '3 x Wiberg Chili thread fine 45g', share: 0.5 },
    share: 0.952,
  },
  {
    name: 'FEELIA OY',
    productCount: 32,
    leastReliable: { product: 'Feelia Burgundy stew 3kg', share: 0.41 },
    share: 0.954,
  },
  {
    name: 'PRESCOTT OY',
    productCount: 86,
    leastReliable: { product: '5x Monarch Chickpeas 3/1,8kg pouch', share: 0 },
    share: 0.958,
  },
  {
    name: 'OY ROLLFOODS AB PAKASTE',
    productCount: 38,
    leastReliable: { product: 'Rollfoods Pita bread oval 115 g x 3 pcs x 16 bag 5,52 kg frozen', share: 0 },
    share: 0.962,
  },
  {
    name: 'OY CONAXESS TRADE FINLAND AB TEOLLI',
    productCount: 23,
    leastReliable: { product: 'Werther´s Original Caramel Popcorn Classic 140gx12', share: 0.25 },
    share: 0.967,
  },
];

/** The request suggested on the dashboard and in the workspace. */
export const EXAMPLE_REQUEST = 'I need 1,000 litres of lactose-free milk by Monday';
