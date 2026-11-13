import { useEffect, useState } from "react";
import {
  fetchAgentRuns,
  fetchAlerts,
  fetchStandingOrders,
  fetchSuggestions,
  fetchOrders,
  fetchPolicies,
  fetchQuotes,
  fetchSuppliers,
  type AgentRun,
  type Order,
  type Policy,
  type Quote,
  type StandingOrderReview,
  type StockAlert,
  type Suggestion,
  type SupplierReliability,
} from "./api";

const POLL_INTERVAL_MS = 4000;

export interface Summary {
  quotes: Quote[];
  orders: Order[];
  policies: Policy[];
  runs: AgentRun[];
  suppliers: SupplierReliability[];
  /** Stock alerts the agents raised on their own, newest first. */
  alerts: StockAlert[];
  /** Each kitchen's standing order, compared with its recent weeks. */
  standingOrders: StandingOrderReview[];
  /** The wholesaler's suggestions, as each kitchen's agent screened them. */
  suggestions: Suggestion[];
  /** How each supplier's delivery reliability is worked out. */
  reliabilityFormula: string;
}

/** Everything the dashboard, overview, and navigation badges need, refreshed on every change and every few seconds. */
export function useSummary(version: number, agentAvailable: boolean): Summary | null {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [quotes, orders, policies, runs, suppliers, alerts, standingOrders, suggestions] = await Promise.all([
          fetchQuotes(controller.signal),
          fetchOrders(controller.signal),
          fetchPolicies(controller.signal),
          agentAvailable ? fetchAgentRuns(controller.signal) : Promise.resolve([]),
          fetchSuppliers(controller.signal),
          fetchAlerts(controller.signal),
          fetchStandingOrders(controller.signal),
          fetchSuggestions(controller.signal),
        ]);
        setSummary({ quotes, orders, policies, runs, suppliers: suppliers.suppliers, alerts, standingOrders, suggestions, reliabilityFormula: suppliers.formula });
      } catch {
        // Each section shows its own error. The overview keeps its last values.
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [version, agentAvailable]);

  return summary;
}
