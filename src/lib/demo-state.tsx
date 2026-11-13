import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { activity, agentRuns, getKitchen, orders, quotes, stockAlerts } from '../data/mock.ts';
import { formatEuro } from './format.ts';
import type { RunPlan } from './agent-sim.ts';
import type { ActivityEntry, AgentRun, KitchenId, Order, Quote, StockAlert } from './types.ts';

/**
 * In-memory state for the demo. It starts from the sample data in
 * src/data/mock.ts and resets on reload; nothing is sent anywhere.
 */
interface DemoState {
  quotes: Quote[];
  orders: Order[];
  runs: AgentRun[];
  alerts: StockAlert[];
  activity: ActivityEntry[];
  revokedMandates: KitchenId[];
}

interface DemoStateValue extends DemoState {
  nextQuoteId: string;
  nextOrderId: string;
  /** Records a finished agent run and what it produced. */
  completeRun: (kitchenId: KitchenId, request: string, plan: RunPlan) => void;
  approveQuote: (quoteId: string) => void;
  rejectQuote: (quoteId: string) => void;
  revokeMandate: (kitchenId: KitchenId) => void;
  /** Clears quotes, orders, alerts, agent runs and activity. */
  reset: () => void;
}

function initialState(): DemoState {
  return {
    quotes: [...quotes],
    orders: [...orders],
    runs: [...agentRuns],
    alerts: [...stockAlerts],
    activity: [...activity],
    revokedMandates: [],
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function clockTime(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sequenceId(prefix: string, count: number): string {
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

let entryCounter = 0;

function entry(fields: Omit<ActivityEntry, 'id' | 'time'>): ActivityEntry {
  entryCounter += 1;
  return { id: `run-${entryCounter}`, time: clockTime(), ...fields };
}

const DemoStateContext = createContext<DemoStateValue | null>(null);

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(initialState);

  const completeRun = useCallback((kitchenId: KitchenId, request: string, plan: RunPlan) => {
    setState((prev) => {
      const kitchen = getKitchen(kitchenId);
      const now = clockTime();
      const run: AgentRun = { id: sequenceId('R', prev.runs.length), kitchenId, request, startedAt: now };
      const next: DemoState = { ...prev, runs: [run, ...prev.runs] };
      const { result } = plan;

      if (result.type === 'quote') {
        const quoteId = sequenceId('Q', prev.quotes.length);
        const quote: Quote = {
          id: quoteId,
          kitchenId,
          summary: result.summary,
          quantity: result.quantity,
          total: result.total,
          delivery: result.delivery,
          status: result.withinRules ? 'ordered' : 'waiting',
          withinRules: result.withinRules,
          reason: result.reason,
          createdAt: now,
        };
        next.quotes = [quote, ...prev.quotes];

        if (result.withinRules) {
          const orderId = sequenceId('O', prev.orders.length);
          next.orders = [
            { id: orderId, quoteId, kitchenId, summary: result.summary, total: result.total, placedAt: now, deliveryDate: result.delivery },
            ...prev.orders,
          ];
          next.activity = [
            entry({
              kitchenId,
              actor: 'agent',
              kind: 'order',
              ref: quoteId,
              text: `${quoteId}: ${result.summary}: within the ${formatEuro(kitchen.spendingLimit)} limit.`,
              detail: `Ordered as ${orderId}. ${result.quantity} for ${formatEuro(result.total)}, delivered ${result.delivery}.`,
            }),
            ...prev.activity,
          ];
        } else {
          next.activity = [
            entry({
              kitchenId,
              actor: 'agent',
              kind: 'quote',
              ref: quoteId,
              text: `${quoteId}: ${result.summary}: needs your approval, ${result.reason ?? 'outside the rules'}.`,
              detail: `Waiting for the buyer. ${result.quantity} for ${formatEuro(result.total)}, delivered ${result.delivery}.`,
            }),
            ...prev.activity,
          ];
        }
      } else if (result.type === 'blocked') {
        next.activity = [
          entry({
            kitchenId,
            actor: 'agent',
            kind: 'blocked',
            text: `Blocked: “${request}”. ${result.rule}.`,
            detail: 'The server refused the quote. This rule cannot be approved.',
          }),
          ...prev.activity,
        ];
      } else if (result.type === 'denied') {
        next.activity = [
          entry({
            kitchenId,
            actor: 'agent',
            kind: 'denied',
            text: `Denied: mandate ${kitchen.mandate.id} is revoked.`,
            detail: `The request “${request}” was refused before any data was read.`,
          }),
          ...prev.activity,
        ];
      } else {
        next.activity = [
          entry({
            kitchenId,
            actor: 'agent',
            kind: 'reply',
            text: `Answered “${request}”.`,
            detail: 'Read only, nothing quoted or ordered.',
          }),
          ...prev.activity,
        ];
      }
      return next;
    });
  }, []);

  const approveQuote = useCallback((quoteId: string) => {
    setState((prev) => {
      const quote = prev.quotes.find((item) => item.id === quoteId);
      if (!quote || quote.status !== 'waiting') return prev;
      const orderId = sequenceId('O', prev.orders.length);
      return {
        ...prev,
        quotes: prev.quotes.map((item) => (item.id === quoteId ? { ...item, status: 'approved' } : item)),
        orders: [
          {
            id: orderId,
            quoteId,
            kitchenId: quote.kitchenId,
            summary: quote.summary,
            total: quote.total,
            placedAt: clockTime(),
            deliveryDate: quote.delivery,
          },
          ...prev.orders,
        ],
        activity: [
          entry({
            kitchenId: quote.kitchenId,
            actor: 'buyer',
            kind: 'approved',
            ref: quoteId,
            text: `${quoteId}: ${quote.summary}: approved by the head chef.`,
            detail: `Ordered as ${orderId}. ${quote.quantity} for ${formatEuro(quote.total)}, delivered ${quote.delivery}.`,
          }),
          ...prev.activity,
        ],
      };
    });
  }, []);

  const rejectQuote = useCallback((quoteId: string) => {
    setState((prev) => {
      const quote = prev.quotes.find((item) => item.id === quoteId);
      if (!quote || quote.status !== 'waiting') return prev;
      return {
        ...prev,
        quotes: prev.quotes.map((item) => (item.id === quoteId ? { ...item, status: 'rejected' } : item)),
        activity: [
          entry({
            kitchenId: quote.kitchenId,
            actor: 'buyer',
            kind: 'rejected',
            ref: quoteId,
            text: `${quoteId}: ${quote.summary}: rejected by the head chef.`,
            detail: 'Nothing ordered.',
          }),
          ...prev.activity,
        ],
      };
    });
  }, []);

  const revokeMandate = useCallback((kitchenId: KitchenId) => {
    setState((prev) => {
      if (prev.revokedMandates.includes(kitchenId)) return prev;
      const kitchen = getKitchen(kitchenId);
      return {
        ...prev,
        revokedMandates: [...prev.revokedMandates, kitchenId],
        activity: [
          entry({
            kitchenId,
            actor: 'buyer',
            kind: 'mandate',
            text: `Mandate ${kitchen.mandate.id} revoked by the head chef.`,
            detail: `The ${kitchen.agentName.toLowerCase()} can no longer act for this kitchen.`,
          }),
          ...prev.activity,
        ],
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, quotes: [], orders: [], runs: [], alerts: [], activity: [] }));
  }, []);

  const value = useMemo<DemoStateValue>(
    () => ({
      ...state,
      nextQuoteId: sequenceId('Q', state.quotes.length),
      nextOrderId: sequenceId('O', state.orders.length),
      completeRun,
      approveQuote,
      rejectQuote,
      revokeMandate,
      reset,
    }),
    [state, completeRun, approveQuote, rejectQuote, revokeMandate, reset],
  );

  return <DemoStateContext.Provider value={value}>{children}</DemoStateContext.Provider>;
}

export function useDemoState(): DemoStateValue {
  const value = useContext(DemoStateContext);
  if (!value) throw new Error('useDemoState must be used inside DemoStateProvider');
  return value;
}
