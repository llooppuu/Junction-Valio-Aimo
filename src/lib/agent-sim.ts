/**
 * A scripted stand-in for the purchasing agent. There is no backend: this
 * turns a request into the API calls the agent would make and their outcome,
 * using only the sample data in src/data/mock.ts.
 */
import { certifiedFish, lactoseFreeMilks, standingOrders } from '../data/mock.ts';
import { analyzeStandingOrder } from './standing-order.ts';
import { formatEuro, formatPercent } from './format.ts';
import type { Kitchen, RunStep, StockAlert } from './types.ts';

const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';

export type RunResult =
  | { type: 'answer' }
  | {
      type: 'quote';
      summary: string;
      total: number;
      quantity: string;
      delivery: string;
      withinRules: boolean;
      reason?: string;
    }
  | { type: 'blocked'; rule: string }
  | { type: 'denied' };

export interface RunPlan {
  steps: RunStep[];
  reply: string;
  result: RunResult;
}

interface RunContext {
  kitchen: Kitchen;
  request: string;
  mandateRevoked: boolean;
  alerts: StockAlert[];
  nextQuoteId: string;
  nextOrderId: string;
}

const NUT_PATTERN = /\b(peanuts?|tree nuts?|cashews?|almonds?|hazelnuts?|walnuts?|pistachios?)\b/i;

function query(text: string): string {
  return encodeURIComponent(text.trim().toLowerCase()).replace(/%20/g, '+').replace(/%2C/gi, ',');
}

/** Finishes a quote: within the limit it is ordered, otherwise it waits for the buyer. */
function quoteSteps(ctx: RunContext, summary: string, total: number, extraReason?: string): {
  steps: RunStep[];
  withinRules: boolean;
  reason?: string;
} {
  const overLimit = total > ctx.kitchen.spendingLimit;
  const reason = overLimit ? `over the ${formatEuro(ctx.kitchen.spendingLimit)} limit` : extraReason;
  const withinRules = !reason;
  const steps: RunStep[] = [
    {
      method: 'POST',
      path: '/api/quotes',
      status: 201,
      summary: withinRules
        ? `${ctx.nextQuoteId}: ${summary}, ${formatEuro(total)}, within the ${formatEuro(ctx.kitchen.spendingLimit)} limit`
        : `${ctx.nextQuoteId}: ${summary}, ${formatEuro(total)}, needs your approval: ${reason}`,
    },
  ];
  if (withinRules) {
    steps.push({
      method: 'POST',
      path: '/api/orders',
      status: 201,
      summary: `${ctx.nextOrderId} placed from ${ctx.nextQuoteId}`,
    });
  }
  return { steps, withinRules, reason };
}

function milkRequest(ctx: RunContext, compareOnly: boolean): RunPlan {
  const [best, cheapest] = lactoseFreeMilks;
  if (!best || !cheapest) throw new Error('Milk sample data is missing');

  const litresMatch = ctx.request.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(?:litres|liters|l)\b/i);
  const litres = litresMatch ? Number(litresMatch[1]) : 100;

  const steps: RunStep[] = [
    {
      method: 'GET',
      path: `/api/products?q=lactose-free+milk&deliverable_by=${MONDAY}`,
      status: 200,
      summary: `${lactoseFreeMilks.length} lactose-free milks deliverable by Monday`,
    },
    {
      method: 'GET',
      path: `/api/suppliers/reliability?products=${best.code},${cheapest.code}`,
      status: 200,
      summary: `${best.supplier} ${formatPercent(best.reliability)}, ${cheapest.supplier} ${formatPercent(cheapest.reliability)} delivered as ordered`,
    },
  ];

  if (compareOnly) {
    const saving = 1 - cheapest.pricePerLitre / best.pricePerLitre;
    return {
      steps,
      reply: `${best.name} from ${best.supplier} is the most reliable: ${formatPercent(best.reliability)} delivered as ordered, at ${formatEuro(best.pricePerLitre)} per litre. The cheapest, ${cheapest.name}, costs ${formatEuro(cheapest.pricePerLitre)} per litre (${formatPercent(saving)} less), but its supplier delivered ${formatPercent(cheapest.reliability)} as ordered. Both can arrive on Monday 16 November. No quote created.`,
      result: { type: 'answer' },
    };
  }

  steps.push({
    method: 'GET',
    path: `/api/products/${best.code}/availability?qty=${litres}`,
    status: 200,
    summary: `${best.stockLitres.toLocaleString('en-GB')} l in stock, delivery Mon 16 Nov, order by 15 Nov 17:00`,
  });

  const total = Math.round(litres * best.pricePerLitre * 100) / 100;
  const quantity = `${litres.toLocaleString('en-GB')} litres`;
  const summary = `${quantity} of ${best.name}`;
  const quote = quoteSteps(ctx, summary, total);
  steps.push(...quote.steps);

  return {
    steps,
    reply: quote.withinRules
      ? `Ordered ${summary} for ${formatEuro(total)}, delivered Monday 16 November. I chose it for its ${formatPercent(best.reliability)} delivery record; the quote was within your ${formatEuro(ctx.kitchen.spendingLimit)} limit.`
      : `I prepared a quote for ${summary}: ${formatEuro(total)}, delivered Monday 16 November. It is ${quote.reason}, so it waits for your approval.`,
    result: {
      type: 'quote',
      summary: `${summary} from ${best.supplier}`,
      total,
      quantity,
      delivery: MONDAY,
      withinRules: quote.withinRules,
      reason: quote.reason,
    },
  };
}

function fishRequest(): RunPlan {
  const list = certifiedFish
    .map((fish) => `${fish.name} (${fish.label}, ${formatEuro(fish.pricePerKg)}/kg)`)
    .join('; ');
  return {
    steps: [
      {
        method: 'GET',
        path: `/api/products?q=fish&labels=MSC,ASC&deliverable_by=${TUESDAY}`,
        status: 200,
        summary: `${certifiedFish.length} certified products deliverable by Tuesday`,
      },
    ],
    reply: `These certified fish can be delivered on Tuesday 17 November: ${list}. The pollock is the cheapest per kilo. No quote created.`,
    result: { type: 'answer' },
  };
}

function alertRequest(ctx: RunContext, alert: StockAlert): RunPlan {
  const { proposal } = alert;
  const summary = `${proposal.quantity} packages of ${proposal.product.split(',')[0]}`;
  const steps: RunStep[] = [
    {
      method: 'GET',
      path: `/api/products/availability?q=${query(proposal.product.split(',')[0] ?? '')}&qty=${proposal.quantity}`,
      status: 200,
      summary: `In stock, delivery ${proposal.delivery}`,
    },
  ];
  const quote = quoteSteps(ctx, summary, proposal.total, proposal.note ? proposal.note : undefined);
  steps.push(...quote.steps);
  return {
    steps,
    reply: quote.withinRules
      ? `Ordered ${summary} from ${proposal.supplier} for ${formatEuro(proposal.total)}, delivered ${proposal.delivery}, replacing ${alert.product}.`
      : `I quoted ${summary} for ${formatEuro(proposal.total)}. It needs your approval: ${quote.reason}.`,
    result: {
      type: 'quote',
      summary: `${summary} from ${proposal.supplier} (${alert.id})`,
      total: proposal.total,
      quantity: `${proposal.quantity} packages`,
      delivery: MONDAY,
      withinRules: quote.withinRules,
      reason: quote.reason,
    },
  };
}

function renewRequest(ctx: RunContext): RunPlan {
  const order = standingOrders.find((item) => item.kitchenId === ctx.kitchen.id);
  if (!order) return fallback(ctx);
  const analysis = analyzeStandingOrder(order);
  const drifted = analysis.lines.filter((line) => line.drifted).map((line) => line.product);
  const summary = `${order.title} for ${order.deliveryDate}`;
  const steps: RunStep[] = [
    {
      method: 'GET',
      path: `/api/standing-orders/${ctx.kitchen.id}-weekly/history?weeks=8`,
      status: 200,
      summary: drifted.length ? `Drift on ${drifted.join(', ')}` : 'Every line within the drift limit',
    },
  ];
  const quote = quoteSteps(ctx, summary, analysis.renewalTotal, drifted.length ? 'drifted from the 8-week average' : undefined);
  steps.push(...quote.steps);
  return {
    steps,
    reply: quote.withinRules
      ? `Renewed the ${summary.toLowerCase()} for ${formatEuro(analysis.renewalTotal)}.`
      : `The renewal is ${formatEuro(analysis.renewalTotal)} and ${quote.reason}, so it waits for your approval.`,
    result: {
      type: 'quote',
      summary,
      total: analysis.renewalTotal,
      quantity: `${order.lines.length} lines`,
      delivery: MONDAY,
      withinRules: quote.withinRules,
      reason: quote.reason,
    },
  };
}

function fallback(ctx: RunContext): RunPlan {
  return {
    steps: [
      {
        method: 'GET',
        path: `/api/products?q=${query(ctx.request).slice(0, 60)}`,
        status: 200,
        summary: 'Matches found in the catalog',
      },
    ],
    reply: `I searched the catalog for “${ctx.request.trim()}”. Tell me the quantity and the delivery day, and I will prepare a quote within your rules.`,
    result: { type: 'answer' },
  };
}

export function planAgentRun(ctx: RunContext): RunPlan {
  const text = ctx.request;

  if (ctx.mandateRevoked) {
    return {
      steps: [
        {
          method: 'GET',
          path: `/api/products?q=${query(text).slice(0, 40)}`,
          status: 401,
          summary: `Mandate ${ctx.kitchen.mandate.id} was revoked; the server refuses the agent's credentials`,
        },
      ],
      reply: `I cannot act: you revoked mandate ${ctx.kitchen.mandate.id}, so the wholesaler refuses my requests.`,
      result: { type: 'denied' },
    };
  }

  const nut = text.match(NUT_PATTERN);
  if (nut) {
    const rule = ctx.kitchen.rules.blocked[0] ?? 'Blocked by the kitchen rules';
    return {
      steps: [
        { method: 'GET', path: `/api/products?q=${query(nut[0])}`, status: 200, summary: 'Products found' },
        { method: 'POST', path: '/api/quotes', status: 422, summary: `Blocked by the server: ${rule.toLowerCase()}` },
      ],
      reply: `I cannot quote that. The kitchen's rules block it: ${rule.toLowerCase()}. This rule cannot be approved.`,
      result: { type: 'blocked', rule },
    };
  }

  const alert = ctx.alerts.find((item) => text.includes(`(${item.id})`));
  if (alert) return alertRequest(ctx, alert);
  if (/^renew the/i.test(text)) return renewRequest(ctx);
  if (/milk/i.test(text)) return milkRequest(ctx, /don.?t create a quote|compare/i.test(text));
  if (/\b(fish|msc|asc|seafood|salmon|cod|pollock)\b/i.test(text)) return fishRequest();
  return fallback(ctx);
}
