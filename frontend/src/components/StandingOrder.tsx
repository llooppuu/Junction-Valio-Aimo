import { CalendarClock, Send } from "lucide-react";
import type { StandingOrderReview } from "../lib/api";
import { formatEuroCents, formatLongDate, formatNumber } from "../lib/format";
import { tr, useI18n } from "../lib/i18n";
import { personName, productName } from "../lib/names";

const signed = (pct: number) => `${pct > 0 ? "+" : ""}${formatNumber(pct)}${tr("standing.pctSuffix")}`;

/** What the agent is asked when the buyer hands the renewal over, in the buyer's language. */
export function renewalRequest(review: StandingOrderReview): string {
  return tr("standing.request", { order: personName(review.name).toLowerCase(), date: review.deliveryDate });
}

/** Eight small bars for the past weeks, then the renewal, so a creeping quantity is visible at a glance. */
function Bars({ history, renewal, flagged, label }: { history: number[]; renewal: number; flagged: boolean; label: string }) {
  const max = Math.max(...history, renewal, 1);
  return (
    <span className="trend-bars" role="img" aria-label={label}>
      {history.map((value, index) => (
        <span key={index} className="trend-bar" style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
      ))}
      <span className={`trend-bar trend-bar-renewal ${flagged ? "trend-bar-flagged" : ""}`} style={{ height: `${Math.max(8, (renewal / max) * 100)}%` }} />
    </span>
  );
}

/** The comparison table: each line and the total against the recent weeks. */
export function StandingOrderTrend({ review }: { review: StandingOrderReview }) {
  const { t } = useI18n();
  const history = t("standing.history", { weeks: review.weeks.length });
  return (
    <div className="trend-wrap">
      <table className="trend-table">
        <thead>
          <tr>
            <th scope="col">{t("col.product")}</th>
            <th scope="col">{history}</th>
            <th scope="col">{t("standing.average")}</th>
            <th scope="col">{t("standing.renewal")}</th>
            <th scope="col">{t("standing.change")}</th>
          </tr>
        </thead>
        <tbody>
          {review.lines.map((line) => (
            <tr key={line.productId} className={line.flagged ? "trend-flagged" : undefined}>
              <th scope="row">{productName(line.productId, line.productName)}</th>
              <td>
                <Bars
                  history={line.history}
                  renewal={line.renewal}
                  flagged={line.flagged}
                  label={`${history}: ${line.history.join(", ")}; ${t("standing.renewal")}: ${line.renewal}`}
                />
              </td>
              <td title={t("standing.spread", { spread: formatNumber(line.spread) })}>{formatNumber(line.mean)}</td>
              <td>{line.renewal}</td>
              <td className="trend-change">{signed(line.changePct)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={review.cost.flagged ? "trend-flagged" : undefined}>
            <th scope="row">{t("standing.total")}</th>
            <td>
              <Bars history={review.cost.history} renewal={review.cost.renewal} flagged={review.cost.flagged} label={t("standing.total")} />
            </td>
            <td>{formatEuroCents(review.cost.mean)}</td>
            <td>{formatEuroCents(review.cost.renewal)}</td>
            <td className="trend-change">{signed(review.cost.changePct)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** On an approval card: why a renewal is waiting, folded open when it drifted. */
export function QuoteStandingOrder({ review }: { review: StandingOrderReview | undefined }) {
  const { t } = useI18n();
  if (!review) return null;
  return (
    <details className="alternatives" open={review.flagged}>
      <summary>{t("standing.trendSummary", { order: personName(review.name) })}</summary>
      <StandingOrderTrend review={review} />
    </details>
  );
}

/** The kitchen's next standing order, checked against its recent weeks before it renews itself. */
export function StandingOrderPanel({
  review,
  agentAvailable,
  onAsk,
}: {
  review: StandingOrderReview | undefined;
  agentAvailable: boolean;
  onAsk: (review: StandingOrderReview) => void;
}) {
  const { t } = useI18n();
  if (!review) return null;
  return (
    <section className={`standing-order ${review.flagged ? "standing-order-flagged" : ""}`} aria-labelledby="standing-order-heading">
      <header className="standing-order-header">
        <h2 id="standing-order-heading" className="stock-alerts-heading">
          <CalendarClock aria-hidden="true" size={20} />
          {t("standing.title")}
        </h2>
        <span className={`standing-order-badge ${review.flagged ? "standing-order-badge-flagged" : ""}`}>
          {review.flagged ? t("standing.flagged") : t("standing.ok")}
        </span>
      </header>
      <p className="section-muted">
        {t("standing.intro", {
          order: personName(review.name),
          date: formatLongDate(review.deliveryDate),
          weeks: review.weeks.length,
          threshold: review.thresholdPct,
        })}
      </p>
      <StandingOrderTrend review={review} />
      <div className="stock-alert-actions">
        <button type="button" className="button-primary button-icon button-small" disabled={!agentAvailable} onClick={() => onAsk(review)}>
          <Send aria-hidden="true" size={16} />
          {t("standing.ask")}
        </button>
        <span className="section-muted">{t("standing.askNote", { threshold: review.thresholdPct })}</span>
      </div>
    </section>
  );
}
