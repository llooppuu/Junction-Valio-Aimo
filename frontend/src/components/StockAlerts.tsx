import { BellRing, Send } from "lucide-react";
import type { StockAlert } from "../lib/api";
import { formatEuroCents, formatLongDate } from "../lib/format";
import { tr, useI18n } from "../lib/i18n";
import { dishName, personName, productName, roleName } from "../lib/names";
import { serverPhrase } from "../lib/reasons";


/** What the agent should do with an alert when the buyer hands it over, in the buyer's language. */
export function alertRequest(alert: StockAlert): string {
  const planned = alert.affects.plannedOrder;
  const swaps = alert.proposals
    .filter((proposal) => proposal.substitute)
    .map((proposal) => {
      const product = `${productName(proposal.substitute!.productId, proposal.substitute!.productName)} (${proposal.substitute!.productId})`;
      return proposal.role ? tr("alerts.requestSwap", { product, role: roleName(proposal.role) }) : product;
    })
    .join(tr("alerts.and"));
  return tr("alerts.request", {
    id: alert.id,
    product: productName(alert.productId, alert.productName),
    problem: serverPhrase(alert.problem),
    action: planned
      ? tr("alerts.requestPlanned", { count: planned.packages, order: personName(planned.name).toLowerCase(), date: planned.deliveryDate })
      : tr("alerts.requestQuote"),
    swaps: swaps || tr("alerts.requestAny"),
  });
}

/**
 * Alerts the kitchen's agent raised on its own when a supplier ran short of
 * something a recipe or the next planned order needs. Each proposes a
 * substitute for the ingredient's role; nothing is ordered until the buyer asks.
 */
export function StockAlerts({
  alerts,
  agentAvailable,
  onAsk,
}: {
  alerts: StockAlert[];
  agentAvailable: boolean;
  onAsk: (alert: StockAlert) => void;
}) {
  const { t, tn } = useI18n();
  const open = alerts.filter((alert) => alert.status === "open");
  if (open.length === 0) return null;

  return (
    <section className="stock-alerts" aria-labelledby="stock-alerts-heading">
      <h2 id="stock-alerts-heading" className="stock-alerts-heading">
        <BellRing size={18} aria-hidden="true" />
        {tn("alerts.heading.one", open.length)}
      </h2>
      {open.map((alert) => {
        const product = productName(alert.productId, alert.productName);
        const planned = alert.affects.plannedOrder;
        return (
          <article key={alert.id} className="stock-alert">
            <p className="stock-alert-title">
              {alert.problem === "out of stock"
                ? t("alerts.outOfStock", { product, supplier: alert.supplier })
                : t("alerts.problem", { product, supplier: alert.supplier, problem: alert.problem })}
              <span className="stock-alert-id">{alert.id}</span>
            </p>
            <p className="stock-alert-affects">
              {[
                alert.affects.dishes.length > 0
                  ? t("alerts.usedIn", {
                      dishes: alert.affects.dishes.map((dish) => `${dishName(dish.dish)} (${roleName(dish.role)})`).join(", "),
                    })
                  : null,
                planned
                  ? tn("alerts.planned.one", planned.packages, {
                      order: personName(planned.name).toLowerCase(),
                      date: formatLongDate(planned.deliveryDate),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(". ")}
              .
            </p>
            <ul className="stock-alert-proposals">
              {alert.proposals.map((proposal, index) => (
                <li key={proposal.role ?? index} className={proposal.substitute ? undefined : "stock-alert-none"}>
                  {proposal.role && <span className="menu-plan-role">{roleName(proposal.role)}</span>}
                  {proposal.substitute ? (
                    <>
                      {t("alerts.proposes", {
                        product: productName(proposal.substitute.productId, proposal.substitute.productName),
                        supplier: proposal.substitute.supplier,
                        count: proposal.substitute.packages,
                        amount: formatEuroCents(proposal.substitute.costEurCents),
                        date: formatLongDate(proposal.substitute.deliveryDate),
                      })}
                      <span className="stock-alert-tradeoff">{proposal.substitute.tradeOff}</span>
                    </>
                  ) : (
                    proposal.note
                  )}
                </li>
              ))}
            </ul>
            <div className="stock-alert-actions">
              <button
                type="button"
                className="button-primary button-icon button-small"
                disabled={!agentAvailable || !alert.proposals.some((proposal) => proposal.substitute)}
                onClick={() => onAsk(alert)}
              >
                <Send size={16} aria-hidden="true" />
                {t("alerts.ask")}
              </button>
              <span className="section-muted">{t("alerts.nothingOrdered")}</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
