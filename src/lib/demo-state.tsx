import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { agentRuns, orders, quotes } from '../data/mock.ts';
import type { AgentRun, Order, Quote } from './types.ts';

/**
 * In-memory state for the demo. It starts from the sample data in
 * src/data/mock.ts and resets on reload; nothing is sent anywhere.
 */
interface DemoState {
  quotes: Quote[];
  orders: Order[];
  runs: AgentRun[];
}

interface DemoStateValue extends DemoState {
  /** Clears quotes, orders and agent runs. */
  reset: () => void;
}

function initialState(): DemoState {
  return {
    quotes: [...quotes],
    orders: [...orders],
    runs: [...agentRuns],
  };
}

const DemoStateContext = createContext<DemoStateValue | null>(null);

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(initialState);

  const reset = useCallback(() => {
    setState({ quotes: [], orders: [], runs: [] });
  }, []);

  const value = useMemo(() => ({ ...state, reset }), [state, reset]);

  return <DemoStateContext.Provider value={value}>{children}</DemoStateContext.Provider>;
}

export function useDemoState(): DemoStateValue {
  const value = useContext(DemoStateContext);
  if (!value) throw new Error('useDemoState must be used inside DemoStateProvider');
  return value;
}
