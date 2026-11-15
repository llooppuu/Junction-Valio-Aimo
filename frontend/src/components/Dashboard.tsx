import { Bot, ClipboardCheck, Hourglass, PackageCheck, ReceiptText, Truck } from "lucide-react";
import type { AgentStatus } from "../lib/api";
import { formatDateTime, formatEuroCents, formatPercent } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName } from "../lib/names";
import type { Summary } from "../lib/useSummary";
import type { View } from "../lib/views";
import { permissionReason } from "../lib/reasons";
import { RiskBadge, reliabilityParts } from "./Risk";

interface DashboardProps {
  summary: Summary | null;
  agent: AgentStatus | null;
  onNavigate: (view: View) => void;
  onShowQuote: (quoteId: string) => void;
}

/**
 * The landing page: stat cards, then what needs attention, recent orders, and
 * supplier reliability. Every number comes from the API, not from mock data.
 */
export function Dashboard({ summary, agent, onNavigate, onShowQuote }: DashboardProps) {
  const { t } = useI18n();
  const quotes = summary?.quotes ?? [];
  const waiting = quotes.filter((quote) => quote.status === "needs_approval");
  const orders = summary?.orders ?? [];
  const spent = orders.reduce((total, order) => total + order.totalEurCents, 0);
  const runs = summary?.runs ?? [];
  const suppliers = [...(summary?.suppliers ?? [])].sort((a, b) => a.reliability - b.reliability).slice(0, 8);
  const atRisk = suppliers.filter((supplier) => supplier.flagged).length;
  const loading = summary === null;

  const stats = [
    {
      key: "waiting",
      label: t("stat.waiting"),
      value: String(waiting.length),
      note:
        waiting.length > 0
          ? t("stat.toReview", { amount: formatEuroCents(waiting.reduce((total, quote) => total + quote.totalEurCents, 0)) })
          : t("stat.nothingToReview"),
      icon: Hourglass,
      attention: waiting.length > 0,
    },
    { key: "orders", label: t("stat.orders"), value: String(orders.length), note: t("stat.inTotal", { amount: formatEuroCents(spent) }), icon: PackageCheck },
    {
      key: "quotes",
      label: t("stat.quotes"),
      value: String(quotes.length),
      note: t("stat.byAgents", { count: quotes.filter((quote) => quote.createdBy.role === "agent").length }),
      icon: ClipboardCheck,
    },
    {
      key: "runs",
      label: t("stat.runs"),
      value: agent?.available ? String(runs.length) : t("stat.off"),
      note: agent?.available
        ? `${runs.some((run) => run.status === "running") ? t("stat.workingNow") : t("stat.idle")} · ${agent.model}`
        : t("stat.turnOn"),
      icon: Bot,
    },
  ];

  return (
    <div className="dashboard">
      <section className="overview" aria-label={t("dash.keyFigures")}>
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.key} className={`stat ${stat.attention ? "stat-attention" : ""}`}>
              <div className="stat-top">
                <p className="stat-label">{stat.label}</p>
                <Icon aria-hidden="true" size={18} className="stat-icon" />
              </div>
              <p className="stat-value">{loading ? "…" : stat.value}</p>
              <p className="stat-note">{stat.note}</p>
            </div>
          );
        })}
      </section>

      <div className="dashboard-grid">
        <section className="dash-card dash-attention" aria-labelledby="dash-waiting">
          <header className="dash-card-header">
            <div>
              <h2 id="dash-waiting">{t("dash.attention")}</h2>
              <p className="section-muted">{t("dash.attentionNote")}</p>
            </div>
            <button type="button" className="button-link" onClick={() => onNavigate("workspace")}>
              {t("dash.review")}
            </button>
          </header>
          {waiting.length === 0 ? (
            <p className="dash-empty">{t("dash.nothingWaiting")}</p>
          ) : (
            <ul className="dash-list">
              {waiting.map((quote) => (
                <li key={quote.id}>
                  <button type="button" className="dash-row" onClick={() => onShowQuote(quote.id)}>
                    <span className="dash-row-main">
                      <strong>{quote.id}</strong> · {personName(quote.createdBy.name)}
                      <span className="dash-row-sub">{permissionReason(quote)}</span>
                    </span>
                    <span className="dash-row-amount">{formatEuroCents(quote.totalEurCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card" aria-labelledby="dash-orders">
          <header className="dash-card-header">
            <div>
              <h2 id="dash-orders">{t("dash.recentOrders")}</h2>
              <p className="section-muted">{t("dash.recentOrdersNote")}</p>
            </div>
            <button type="button" className="button-link" onClick={() => onNavigate("orders")}>
              {t("dash.viewAll")}
            </button>
          </header>
          {orders.length === 0 ? (
            <p className="dash-empty">
              <ReceiptText aria-hidden="true" size={18} /> {t("dash.noOrders")}
            </p>
          ) : (
            <ul className="dash-list">
              {orders.slice(0, 5).map((order) => (
                <li key={order.id}>
                  <button type="button" className="dash-row" onClick={() => onShowQuote(order.quoteId)}>
                    <span className="dash-row-main">
                      <strong>{order.id}</strong> · {order.lines.map((line) => line.supplier).join(", ")}
                      <span className="dash-row-sub">
                        {t("dash.placedBy", { time: formatDateTime(order.placedAt), name: personName(order.placedBy.name) })}
                      </span>
                    </span>
                    <span className="dash-row-amount">{formatEuroCents(order.totalEurCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card dash-wide" aria-labelledby="dash-suppliers">
          <header className="dash-card-header">
            <div>
              <h2 id="dash-suppliers">{t("dash.reliability")}</h2>
              <p className="section-muted">
                {t("dash.reliabilityNote")}
                {atRisk > 0 ? ` · ${t("dash.toWatch", { count: atRisk })}` : ""}
              </p>
            </div>
            <Truck aria-hidden="true" size={20} className="stat-icon" />
          </header>
          <ul className="supplier-list">
            {suppliers.map((supplier) => (
              <li key={supplier.supplier} className="supplier-row">
                <span className="supplier-name">
                  {supplier.supplier}
                  <span className="supplier-parts">{reliabilityParts(supplier)}</span>
                </span>
                <span className="supplier-bar" aria-hidden="true">
                  <span className={`supplier-bar-fill risk-fill-${supplier.riskLevel}`} style={{ width: `${supplier.reliability * 100}%` }} />
                </span>
                <span className="supplier-rate">{formatPercent(supplier.reliability)}</span>
                <RiskBadge reliability={supplier} />
              </li>
            ))}
          </ul>
          {summary && <p className="supplier-formula">{t("dash.score", { formula: summary.reliabilityFormula })}</p>}
        </section>
      </div>
    </div>
  );
}
