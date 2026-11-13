import type { StandingOrder, StandingOrderLine } from './types.ts';

export interface AnalyzedLine extends StandingOrderLine {
  average: number;
  /** Renewal compared with the average, as a share (0.2 = 20% more). */
  change: number;
  drifted: boolean;
}

export interface AnalyzedStandingOrder {
  lines: AnalyzedLine[];
  /** Weekly totals at today's prices, oldest first. */
  totalHistory: number[];
  averageTotal: number;
  renewalTotal: number;
  totalChange: number;
  totalDrifted: boolean;
  drifted: boolean;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function relativeChange(value: number, base: number): number {
  return base === 0 ? 0 : value / base - 1;
}

/** Compares a standing order's renewal with its recent history. */
export function analyzeStandingOrder(order: StandingOrder): AnalyzedStandingOrder {
  const lines = order.lines.map((line) => {
    const average = mean(line.history);
    const change = relativeChange(line.renewal, average);
    return { ...line, average, change, drifted: Math.abs(change) > order.driftLimit };
  });

  const weeks = Math.max(0, ...order.lines.map((line) => line.history.length));
  const totalHistory = Array.from({ length: weeks }, (_, week) =>
    order.lines.reduce((sum, line) => sum + (line.history[week] ?? 0) * line.unitPrice, 0),
  );
  const averageTotal = lines.reduce((sum, line) => sum + line.average * line.unitPrice, 0);
  const renewalTotal = lines.reduce((sum, line) => sum + line.renewal * line.unitPrice, 0);
  const totalChange = relativeChange(renewalTotal, averageTotal);
  const totalDrifted = Math.abs(totalChange) > order.driftLimit;

  return {
    lines,
    totalHistory,
    averageTotal,
    renewalTotal,
    totalChange,
    totalDrifted,
    drifted: totalDrifted || lines.some((line) => line.drifted),
  };
}
