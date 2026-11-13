/**
 * Sample data for the whole app. There is no backend: every view reads from
 * here, and changes made in the UI live only in memory.
 */
import type {
  AgentRun,
  Kitchen,
  KitchenId,
  Order,
  Quote,
  StandingOrder,
  StockAlert,
  SupplierReliability,
} from '../lib/types.ts';

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

// ---------------------------------------------------------------------------
// Kitchens, their agents, rules and signed mandates
// ---------------------------------------------------------------------------

export const kitchens: Kitchen[] = [
  {
    id: 'hotel',
    name: 'Hotel chain',
    agentName: 'Hotel chain purchasing agent',
    spendingLimit: 1400,
    rules: {
      blocked: ['Anything containing peanuts, tree nuts, even as traces'],
      needsApproval: [
        'Quotes over €1,400.00',
        'More than €1,400.00 committed by the agent in one day, so splitting an order does not help',
        'Milk that is not lactose-free',
      ],
    },
    mandate: {
      id: 'M-0001',
      categories: 'Every product category',
      validUntil: 'Thursday 11 February',
      signer: 'did:key:z6MkrtuK…qX4Rb5MF',
    },
  },
  {
    id: 'school',
    name: 'School kitchen',
    agentName: 'School kitchen purchasing agent',
    spendingLimit: 600,
    rules: {
      blocked: ['Anything containing peanuts, tree nuts, even as traces', 'Fish that is not MSC or ASC certified'],
      needsApproval: [
        'Quotes over €600.00',
        'More than €600.00 committed by the agent in one day, so splitting an order does not help',
        'Products that are not of Finnish origin',
      ],
    },
    mandate: {
      id: 'M-0002',
      categories: 'Dairy, vegetables, bread, dry goods',
      validUntil: 'Wednesday 30 June',
      signer: 'did:key:z6MkpQ7v…tL2Wc9Nd',
    },
  },
];

export function getKitchen(id: KitchenId): Kitchen {
  const kitchen = kitchens.find((item) => item.id === id);
  if (!kitchen) throw new Error(`Unknown kitchen: ${id}`);
  return kitchen;
}

// ---------------------------------------------------------------------------
// Stock alerts the agents raised on their own
// ---------------------------------------------------------------------------

export const stockAlerts: StockAlert[] = [
  {
    id: 'AL-0001',
    kitchenId: 'hotel',
    product: 'Oddlygood® Cooking 1 l UHT',
    supplier: 'VALIO OY TUORE',
    problem: 'Valio Aimo cannot deliver it on any date',
    usage:
      'Used in Roasted beetroot soup with oat cream (finishing cream). 2 packages on the weekly kitchen order for Monday 16 November.',
    proposal: {
      role: 'finishing cream',
      product: 'Fazer Aito Oat for Cooking oat product for cooking 1L, gluten-free oat product for cooking',
      supplier: 'FAZER FINLAND OY / LIFESTYLE',
      quantity: 20,
      total: 53,
      delivery: 'Monday 16 November',
      priceDelta: 2,
    },
  },
  {
    id: 'AL-0002',
    kitchenId: 'school',
    product: 'Oddlygood® Cooking 1 l UHT',
    supplier: 'VALIO OY TUORE',
    problem: 'Valio Aimo cannot deliver it on any date',
    usage: 'Used in Roasted beetroot soup with oat cream (finishing cream).',
    proposal: {
      role: 'finishing cream',
      product: 'Fazer Aito Oat for Cooking oat product for cooking 1L, gluten-free oat product for cooking',
      supplier: 'FAZER FINLAND OY / LIFESTYLE',
      quantity: 10,
      total: 26.5,
      delivery: 'Monday 16 November',
      priceDelta: 1,
    },
  },
  {
    id: 'AL-0003',
    kitchenId: 'school',
    product: 'Oddlygood® Cooking Oat 1 l original gluten free',
    supplier: 'VALIO OY TUORE',
    problem: 'Valio Aimo cannot deliver it on any date',
    usage: '10 packages on the weekly school kitchen order for Monday 16 November.',
    proposal: {
      role: 'cooking oat',
      product: 'Oatly iMat for Cooking 1L',
      supplier: 'OATLY EMEA AB TUORE',
      quantity: 10,
      total: 24.8,
      delivery: 'Monday 16 November',
      priceDelta: -0.7,
      note: 'not Finnish origin',
    },
  },
];

// ---------------------------------------------------------------------------
// Weekly standing orders, compared with the last 8 weeks before renewal
// ---------------------------------------------------------------------------

export const standingOrders: StandingOrder[] = [
  {
    kitchenId: 'hotel',
    title: 'Weekly kitchen order',
    deliveryDate: 'Monday 16 November',
    driftLimit: 0.2,
    lines: [
      { product: 'Kieku Barn Eggs L180 12300g', history: [2, 2, 2, 2, 2, 2, 2, 2], renewal: 2, unitPrice: 29.8 },
      { product: 'Valio butter 500 g unsalted', history: [10, 10, 10, 10, 10, 10, 10, 10], renewal: 10, unitPrice: 4.29 },
      { product: 'Valio Emmental red label e2,5 kg grated', history: [2, 2, 2, 2, 2, 3, 3, 3], renewal: 4, unitPrice: 23.49 },
      {
        product: 'Valio whipping cream 1 l UHT lactose free',
        history: [12, 12, 12, 12, 12, 12, 12, 12],
        renewal: 12,
        unitPrice: 2.67,
      },
      { product: 'RED BEETROOT WASHED FINLAND', history: [20, 20, 20, 20, 20, 20, 20, 20], renewal: 20, unitPrice: 1.37 },
      { product: 'Oddlygood® Cooking 1 l UHT', history: [2, 2, 2, 2, 2, 2, 2, 2], renewal: 2, unitPrice: 25.5 },
    ],
  },
  {
    kitchenId: 'school',
    title: 'Weekly school kitchen order',
    deliveryDate: 'Monday 16 November',
    driftLimit: 0.2,
    lines: [
      {
        product: 'Valio Eila® lactose free semi-skimmed milk drink 1 l',
        history: [60, 60, 64, 60, 60, 56, 60, 60],
        renewal: 60,
        unitPrice: 1.32,
      },
      {
        product: 'Oddlygood® Cooking Oat 1 l original gluten free',
        history: [10, 10, 10, 10, 10, 10, 10, 10],
        renewal: 10,
        unitPrice: 2.55,
      },
      { product: 'POTATO PEELED WHOLE FINLAND 5 kg', history: [12, 12, 14, 12, 12, 12, 10, 12], renewal: 12, unitPrice: 6.9 },
      { product: 'CARROT WASHED FINLAND 10 kg', history: [4, 4, 4, 4, 5, 4, 4, 4], renewal: 4, unitPrice: 9.8 },
      { product: 'Fazer Ruispalat rye bread 12 pcs 660 g', history: [18, 18, 18, 20, 18, 18, 18, 18], renewal: 20, unitPrice: 3.15 },
    ],
  },
];
