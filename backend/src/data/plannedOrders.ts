import { addDays } from "../services/dates.js";
import { SCENARIO_PRODUCTS as P } from "./recipes.js";

/**
 * Each kitchen's next planned order: the weekly delivery it places unless
 * something changes, on real Valio Aimo product codes. Kitchens get their
 * weekly delivery on Mondays, so the dates follow the real calendar. The
 * stock watch compares Valio Aimo's live availability against these lines, so
 * a stock-out is noticed before the order goes out, not when it fails.
 */
export interface PlannedOrder {
  agentId: string;
  name: string;
  /** The delivery date the order is planned for. */
  deliveryDate: string;
  lines: { productId: string; packages: number }[];
}

/** The first Monday after today. */
export function nextMonday(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, ((8 - weekday) % 7) || 7);
}

const PLANNED_LINES: Omit<PlannedOrder, "deliveryDate">[] = [
  {
    agentId: "demo-agent",
    name: "Weekly kitchen order",
    lines: [
      { productId: P.eggs, packages: 2 },
      { productId: P.butter, packages: 10 },
      { productId: P.emmental, packages: 4 },
      { productId: P.whippingCream, packages: 12 },
      { productId: P.beetroot, packages: 20 },
      { productId: P.oatCream, packages: 2 },
    ],
  },
  {
    agentId: "school-agent",
    name: "Weekly school kitchen order",
    lines: [
      { productId: P.eggs, packages: 1 },
      { productId: P.oatDrink, packages: 60 },
      { productId: P.wheatFlour, packages: 1 },
      { productId: P.oatCookingSchool, packages: 10 },
    ],
  },
];

/** The kitchens' next planned orders, for delivery next Monday. */
export function plannedOrders(today: string): PlannedOrder[] {
  const deliveryDate = nextMonday(today);
  return PLANNED_LINES.map((order) => ({ ...order, deliveryDate }));
}

/** One delivered week of a standing order. */
export interface PastWeek {
  deliveryDate: string;
  lines: { productId: string; packages: number }[];
}

/** Each kitchen's last eight weekly quantities per product, oldest first. Ours, not Valio Aimo's. */
const SERIES: Record<string, Record<string, number[]>> = {
  // The hotel's Emmental creeps up from two packages to three, the kind of drift a buyer misses when an order renews itself.
  "demo-agent": {
    [P.eggs]: [2, 2, 2, 2, 2, 2, 2, 2],
    [P.butter]: [10, 10, 10, 10, 10, 10, 10, 10],
    [P.emmental]: [2, 2, 2, 2, 2, 3, 3, 3],
    [P.whippingCream]: [12, 12, 12, 12, 12, 12, 12, 12],
    [P.beetroot]: [20, 20, 20, 20, 20, 20, 20, 20],
    [P.oatCream]: [2, 2, 2, 2, 2, 2, 2, 2],
  },
  "school-agent": {
    [P.eggs]: [1, 1, 1, 1, 1, 1, 1, 1],
    [P.oatDrink]: [60, 60, 55, 60, 60, 60, 60, 60],
    [P.wheatFlour]: [1, 1, 1, 1, 1, 1, 1, 1],
    [P.oatCookingSchool]: [10, 10, 10, 10, 10, 10, 10, 10],
  },
};

/** The last eight weekly deliveries of a kitchen's standing order, the Mondays before the next one, oldest first. */
export function standingOrderHistory(agentId: string, today: string): PastWeek[] {
  const series = SERIES[agentId];
  if (!series) return [];
  const next = nextMonday(today);
  return Array.from({ length: 8 }, (_, week) => ({
    deliveryDate: addDays(next, -7 * (8 - week)),
    lines: Object.entries(series).map(([productId, packages]) => ({ productId, packages: packages[week]! })),
  }));
}
