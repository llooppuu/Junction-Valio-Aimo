import type { MessageKey } from "./messages";

export type View = "dashboard" | "workspace" | "catalog" | "orders" | "activity" | "wholesaler";

export const VIEWS = ["dashboard", "workspace", "catalog", "orders", "activity", "wholesaler"] as const satisfies readonly View[];

/** The buyer's views, in the order the main navigation shows them. The wholesaler's view has its own tab. */
export const BUYER_VIEWS = ["dashboard", "workspace", "catalog", "orders", "activity"] as const satisfies readonly View[];

export const VIEW_NAMES: Record<View, MessageKey> = {
  dashboard: "nav.dashboard",
  workspace: "nav.workspace",
  catalog: "nav.catalog",
  orders: "nav.orders",
  activity: "nav.activity",
  wholesaler: "nav.wholesaler",
};
