import type { Order, Quote } from "../lib/api";
import { AlternativesList } from "./Alternatives";
import { QuotePlan } from "./MenuPlanTable";
import { QuoteStandingOrder } from "./StandingOrder";
import { formatDateTime, formatDeliveryDate, formatEuroCents, formatPackages, formatQuantity } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName, productName } from "../lib/names";

interface OrdersViewProps {
  orders: Order[] | null;
  /** The quotes behind the orders, for the alternatives the agent considered. */
  quotes: Quote[];
  onShowQuote: (quoteId: string) => void;
}

/** Orders placed from authorized quotes, newest first. */
export function OrdersView({ orders, quotes, onShowQuote }: OrdersViewProps) {
  const { t } = useI18n();
  return (
    <section aria-label={t("nav.orders")}>
      <p className="section-muted section-note">{t("orders.note")}</p>

      {orders === null && <p className="section-muted">{t("orders.loading")}</p>}

      {orders?.length === 0 && (
        <div className="empty-state">
          <h3>{t("orders.emptyTitle")}</h3>
          <p>{t("orders.emptyText")}</p>
        </div>
      )}

      {orders && orders.length > 0 && (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.id} className="order-card">
              <header className="order-header">
                <div>
                  <h3>{t("orders.order", { id: order.id })}</h3>
                  <p className="section-muted">
                    {t("orders.placed", { time: formatDateTime(order.placedAt), name: personName(order.placedBy.name) })} ·{" "}
                    <button type="button" className="activity-link" onClick={() => onShowQuote(order.quoteId)}>
                      {order.quoteId}
                    </button>
                  </p>
                </div>
                <div className="order-total">
                  <span className="approval-total-amount">{formatEuroCents(order.totalEurCents)}</span>
                  <span>{t("orders.delivery", { date: formatDeliveryDate(order.deliveryDate) })}</span>
                  <a className="button-link order-export" href={`/api/orders/${encodeURIComponent(order.id)}/ubl`} download={`${order.id}.xml`} title={t("orders.exportHint")}>
                    {t("orders.export")}
                  </a>
                </div>
              </header>
              <ul className="order-lines">
                {order.lines.map((line) => (
                  <li key={line.productId}>
                    <span>
                      {productName(line.productId, line.productName)}
                      <span className="approval-supplier">{line.supplier}</span>
                    </span>
                    <span className="order-line-quantity">
                      {formatPackages(line.packages)} · {formatQuantity(line.quantity.amount, line.quantity.unit)}
                    </span>
                    <span className="order-line-total">{formatEuroCents(line.lineTotalEurCents)}</span>
                  </li>
                ))}
              </ul>
              <QuoteStandingOrder review={quotes.find((quote) => quote.id === order.quoteId)?.standingOrder} />
              <QuotePlan plan={quotes.find((quote) => quote.id === order.quoteId)?.plan} />
              <AlternativesList alternatives={quotes.find((quote) => quote.id === order.quoteId)?.alternatives} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
