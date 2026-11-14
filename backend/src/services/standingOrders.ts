import { plannedOrders, standingOrderHistory } from "../data/plannedOrders.js";
import { helsinkiDate } from "./dates.js";
import { ApiError } from "../http.js";
import type { Principal } from "../auth.js";
import type { Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { formatEur, type GuardrailCheck } from "./permissions.js";
import { createQuote, type Quote } from "./quotes.js";
import { fiDate, fiEur } from "../i18n.js";

/** The standing orders' names in Finnish. */
const ORDER_NAME_FI: Record<string, string> = {
  "Weekly kitchen order": "viikoittainen keittiötilaus",
  "Weekly school kitchen order": "koulukeittiön viikkotilaus",
};
const orderNameFi = (name: string) => ORDER_NAME_FI[name] ?? name;

/**
 * Standing order drift: before a weekly order renews itself, compare it with
 * the last eight weeks. A line or a total that differs from the average by
 * more than the threshold is flagged, and a flagged renewal needs the buyer's
 * approval, with the trend attached. The mean and spread are the same
 * statistics a buffer-stock model uses for demand.
 */

export const DRIFT_THRESHOLD_PCT = 20;

export interface Trend {
  /** Oldest first. */
  history: number[];
  mean: number;
  /** Population standard deviation of the history. */
  spread: number;
  renewal: number;
  /** How far the renewal is from the mean, in percent. */
  changePct: number;
  flagged: boolean;
}

export interface StandingOrderReview {
  agentId: string;
  buyerName: string;
  name: string;
  deliveryDate: string;
  thresholdPct: number;
  /** The delivery dates of the weeks compared, oldest first. */
  weeks: string[];
  lines: (Trend & { productId: string; productName: string; packagePriceEurCents: number; unavailableReason?: string })[];
  /** Weekly cost at today's prices, so the comparison is about what is ordered. */
  cost: Trend;
  flagged: boolean;
  /** One sentence for the buyer, for example "Emmental: 4 packages against an average of 2.4 (+68%)". */
  summary: string;
  /** The same sentence in Finnish. */
  summaryFi: string;
}

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

export function trend(history: number[], renewal: number): Trend {
  const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
  const spread = Math.sqrt(history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length);
  const changePct = mean === 0 ? (renewal === 0 ? 0 : 100) : ((renewal - mean) / mean) * 100;
  return {
    history,
    mean: round(mean, 2),
    spread: round(spread, 2),
    renewal,
    changePct: round(changePct),
    flagged: Math.abs(changePct) > DRIFT_THRESHOLD_PCT,
  };
}

const signed = (pct: number) => `${pct > 0 ? "+" : ""}${pct}%`;

export function reviewStandingOrder(store: Store, agentId: string): StandingOrderReview {
  const today = helsinkiDate(store.clock());
  const planned = plannedOrders(today).find((order) => order.agentId === agentId);
  const weeks = standingOrderHistory(agentId, today);
  const policy = store.policies.get(agentId);
  if (!planned || weeks.length === 0 || !policy) throw new ApiError(404, `No standing order for "${agentId}".`);

  const price = (productId: string) => store.products.find((product) => product.id === productId)?.pricePerPackageEurCents ?? 0;
  const productIds = [...new Set([...planned.lines, ...weeks.flatMap((week) => week.lines)].map((line) => line.productId))];
  const packagesIn = (lines: { productId: string; packages: number }[], productId: string) =>
    lines.find((line) => line.productId === productId)?.packages ?? 0;

  const lines = productIds.map((productId) => {
    const product = store.products.find((candidate) => candidate.id === productId);
    return {
      productId,
      productName: product?.name ?? productId,
      // A line Valio Aimo cannot deliver is shown with the reason, and left out of the renewal.
      ...(product?.unavailableReason ? { unavailableReason: product.unavailableReason } : {}),
      packagePriceEurCents: price(productId),
      ...trend(
        weeks.map((week) => packagesIn(week.lines, productId)),
        packagesIn(planned.lines, productId),
      ),
    };
  });
  const weekCost = (weekLines: { productId: string; packages: number }[]) =>
    weekLines.reduce((sum, line) => sum + line.packages * price(line.productId), 0);
  const cost = trend(weeks.map((week) => weekCost(week.lines)), weekCost(planned.lines));
  cost.mean = Math.round(cost.mean);
  cost.spread = Math.round(cost.spread);

  const drifted = lines.filter((line) => line.flagged);
  const flagged = drifted.length > 0 || cost.flagged;
  const parts = [
    ...drifted.map((line) => `${line.productName}: ${line.renewal} packages against an average of ${round(line.mean)} (${signed(line.changePct)})`),
    ...(cost.flagged ? [`total ${formatEur(cost.renewal)} against an average of ${formatEur(cost.mean)} (${signed(cost.changePct)})`] : []),
  ];
  const fiNumber = (value: number) => String(round(value)).replace(".", ",");
  const partsFi = [
    ...drifted.map((line) => {
      const nameFi = store.products.find((candidate) => candidate.id === line.productId)?.nameFi ?? line.productName;
      return `${nameFi}: ${line.renewal} myyntierää, keskiarvo ${fiNumber(line.mean)} (${signed(line.changePct)})`;
    }),
    ...(cost.flagged ? [`yhteensä ${fiEur(cost.renewal)}, keskiarvo ${fiEur(cost.mean)} (${signed(cost.changePct)})`] : []),
  ];

  return {
    agentId,
    buyerName: policy.buyerName,
    name: planned.name,
    deliveryDate: planned.deliveryDate,
    thresholdPct: DRIFT_THRESHOLD_PCT,
    weeks: weeks.map((week) => week.deliveryDate),
    lines,
    cost,
    flagged,
    summary: flagged
      ? `Drifted more than ${DRIFT_THRESHOLD_PCT}% from the last ${weeks.length} weeks: ${parts.join("; ")}.`
      : `Every line and the total (${formatEur(cost.renewal)}) are within ${DRIFT_THRESHOLD_PCT}% of the last ${weeks.length} weeks.`,
    summaryFi: flagged
      ? `Poikkeaa yli ${DRIFT_THRESHOLD_PCT} % viimeisistä ${weeks.length} viikosta: ${partsFi.join("; ")}.`
      : `Jokainen rivi ja kokonaissumma (${fiEur(cost.renewal)}) ovat ${DRIFT_THRESHOLD_PCT} %:n sisällä viimeisistä ${weeks.length} viikosta.`,
  };
}

/** The drift check as a guardrail, so it sits beside the other rules on the quote. */
export function driftCheck(review: StandingOrderReview): GuardrailCheck {
  return {
    rule: "standing_order_drift",
    outcome: review.flagged ? "needs_approval" : "passed",
    detail: review.flagged
      ? review.summary.charAt(0).toLowerCase() + review.summary.slice(1, -1)
      : `within ${review.thresholdPct}% of the last ${review.weeks.length} weeks`,
    detailFi: review.flagged
      ? review.summaryFi.charAt(0).toLowerCase() + review.summaryFi.slice(1, -1)
      : `${review.thresholdPct} %:n sisällä viimeisistä ${review.weeks.length} viikosta`,
  };
}

/**
 * Renews the standing order as a quote. The lines come from the planned order,
 * never from the caller, so nobody can trim a line to slip past the check.
 */
export function renewStandingOrder(
  store: Store,
  agentId: string,
  principal: Principal,
): { quote: Quote; review: StandingOrderReview; leftOut: { productId: string; productName: string; reason: string }[] } {
  const review = reviewStandingOrder(store, agentId);
  const planned = plannedOrders(helsinkiDate(store.clock())).find((order) => order.agentId === agentId)!;
  // A line Valio Aimo cannot deliver is left out with the reason, instead of failing the whole renewal.
  const leftOut = planned.lines
    .map((line) => store.products.find((product) => product.id === line.productId))
    .filter((product): product is NonNullable<typeof product> => !!product?.unavailableReason)
    .map((product) => ({ productId: product.id, productName: product.name, reason: product.unavailableReason! }));
  const lines = planned.lines.filter((line) => line.packages > 0 && !leftOut.some((skipped) => skipped.productId === line.productId));
  if (lines.length === 0) throw new ApiError(409, `None of the ${review.name.toLowerCase()} can be delivered for ${review.deliveryDate}.`, { leftOut });
  recordAudit(store, principal, {
    action: "standing_order.reviewed",
    summary: `Reviewed the renewal of the ${review.name.toLowerCase()} for ${review.deliveryDate} against the last ${review.weeks.length} weeks.`,
    reason: leftOut.length > 0 ? `${review.summary} Left out: ${leftOut.map((line) => `${line.productName} (${line.reason})`).join("; ")}.` : review.summary,
    fi: {
      summary: `Tarkistettiin tilauksen ${orderNameFi(review.name)} uusinta toimitukselle ${fiDate(review.deliveryDate)} viimeisiin ${review.weeks.length} viikkoon verrattuna.`,
      reason:
        leftOut.length > 0
          ? `${review.summaryFi} Jätettiin pois: ${leftOut.map((line) => store.products.find((product) => product.id === line.productId)?.nameFi ?? line.productName).join(", ")}, koska Valio Aimo ei voi toimittaa niitä.`
          : review.summaryFi,
    },
  });
  const quote = createQuote(
    store,
    {
      lines: lines.map((line) => ({ productId: line.productId, quantity: { amount: line.packages, unit: "package" as const } })),
      requirements: { deliverBy: review.deliveryDate },
    },
    principal,
    { extraChecks: [driftCheck(review)], standingOrder: review },
  );
  return { quote, review, leftOut };
}
