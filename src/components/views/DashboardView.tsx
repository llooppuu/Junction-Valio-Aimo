import { ArrowRight, Bot, ClipboardCheck, Hourglass, Milk, Package, ReceiptText, ShieldCheck, Truck, TriangleAlert } from 'lucide-react';
import PageHero from '../ui/PageHero.tsx';
import Button from '../ui/Button.tsx';
import Badge from '../ui/Badge.tsx';
import Meter from '../ui/Meter.tsx';
import { Panel, StatCard } from '../ui/Card.tsx';
import { hrefFor } from '../../lib/router.ts';
import { requestComposerFocus } from '../../lib/composer.ts';
import { useDemoState } from '../../lib/demo-state.tsx';
import { formatEuro, formatPercent } from '../../lib/format.ts';
import {
  AGENT_MODEL,
  EXAMPLE_REQUEST,
  RELIABILITY_WATCH_THRESHOLD,
  WHOLESALER_NAME,
  supplierReliability,
} from '../../data/mock.ts';
import '../../styles/dashboard.css';

export default function DashboardView() {
  const { quotes, orders, runs } = useDemoState();

  const waiting = quotes.filter((quote) => quote.status === 'waiting');
  const ordersTotal = orders.reduce((sum, order) => sum + order.total, 0);
  const recentOrders = orders.slice(0, 5);
  const suppliers = [...supplierReliability].sort((a, b) => a.share - b.share);
  const toWatch = suppliers.filter((supplier) => supplier.share < RELIABILITY_WATCH_THRESHOLD).length;

  return (
    <>
      <PageHero
        variant="primary"
        eyebrow="Purchasing overview"
        title="Dashboard"
        lead="What your purchasing agents did, and what is waiting for you."
        actions={
          <>
            <Button variant="outline-light" href={hrefFor('catalog')}>
              Browse the catalog
            </Button>
            <Button
              variant="accent"
              href={hrefFor('workspace')}
              icon={<Bot size={18} aria-hidden="true" />}
              onClick={() => requestComposerFocus()}
            >
              Ask the agent
            </Button>
          </>
        }
      />

      <div className="container page-body dashboard">
        <h2 className="visually-hidden">Key figures</h2>
        <div className="stat-grid">
          <StatCard
            label="Waiting for your approval"
            value={waiting.length}
            sub={waiting.length === 0 ? 'Nothing to review' : `${waiting.length} to review`}
            icon={<Hourglass size={18} />}
          />
          <StatCard
            label="Orders placed"
            value={orders.length}
            sub={`${formatEuro(ordersTotal)} in total`}
            icon={<Package size={18} />}
          />
          <StatCard
            label="Quotes prepared"
            value={quotes.length}
            sub={`${quotes.length} by the agents`}
            icon={<ClipboardCheck size={18} />}
          />
          <StatCard
            label="Agent runs"
            value={runs.length}
            sub={`${runs.length === 0 ? 'Idle' : 'Active'} · ${AGENT_MODEL}`}
            icon={<Bot size={18} />}
          />
        </div>

        <div className="dashboard__pair">
          <Panel
            accent="accent"
            title="Needs your attention"
            subtitle="Quotes the agents may not order without you"
            action={
              <a className="link-action" href={hrefFor('workspace')}>
                Review
              </a>
            }
          >
            {waiting.length === 0 ? (
              <p className="dashboard__empty">Nothing is waiting. The agents are within their rules.</p>
            ) : (
              <ul className="dashboard__list" role="list">
                {waiting.map((quote) => (
                  <li key={quote.id}>
                    <span className="dashboard__list-id">{quote.id}</span> {quote.summary}
                    <span className="dashboard__list-amount">{formatEuro(quote.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent orders"
            subtitle="Placed from authorized quotes"
            action={
              <a className="link-action" href={hrefFor('orders')}>
                View all
              </a>
            }
          >
            {recentOrders.length === 0 ? (
              <p className="dashboard__empty dashboard__empty--icon">
                <ReceiptText size={18} aria-hidden="true" />
                No orders yet.
              </p>
            ) : (
              <ul className="dashboard__list" role="list">
                {recentOrders.map((order) => (
                  <li key={order.id}>
                    <span className="dashboard__list-id">{order.id}</span> {order.summary}
                    <span className="dashboard__list-amount">{formatEuro(order.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          className="reliability"
          title="Supplier reliability"
          subtitle={`Share of ordered quantities delivered as ordered, from ${WHOLESALER_NAME}'s history · ${toWatch} to watch`}
          icon={<Truck size={20} />}
        >
          <ul className="reliability__list" role="list">
            {suppliers.map((supplier) => {
              const watch = supplier.share < RELIABILITY_WATCH_THRESHOLD;
              return (
                <li key={supplier.name} className="reliability__row">
                  <div className="reliability__who">
                    <p className="reliability__name">{supplier.name}</p>
                    <p className="reliability__note">
                      {supplier.productCount} products on record; the least reliable is{' '}
                      {supplier.leastReliable.product} at {formatPercent(supplier.leastReliable.share)}
                    </p>
                  </div>
                  <Meter
                    className="reliability__bar"
                    value={supplier.share}
                    tone={watch ? 'warning' : 'primary'}
                    label={`${supplier.name} delivery reliability`}
                  />
                  <span className="reliability__value">{formatPercent(supplier.share)}</span>
                  {watch ? (
                    <Badge tone="warning" icon={<TriangleAlert aria-hidden="true" />}>
                      Moderate delivery risk
                    </Badge>
                  ) : (
                    <Badge tone="info" icon={<ShieldCheck aria-hidden="true" />}>
                      Low delivery risk
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="reliability__footnote">
            Share of ordered quantities delivered as ordered, from {WHOLESALER_NAME}'s delivery history (1 = everything
            delivered as ordered). A supplier's figure is the average over its products with a record.
          </p>
        </Panel>

        <a
          className="cta-banner"
          href={hrefFor('workspace')}
          onClick={() => requestComposerFocus(EXAMPLE_REQUEST)}
        >
          <Milk size={22} aria-hidden="true" className="cta-banner__icon" />
          <span className="cta-banner__text">
            <strong>Hand the agent a request,</strong> such as “{EXAMPLE_REQUEST}”
          </span>
          <ArrowRight size={22} aria-hidden="true" className="cta-banner__arrow" />
        </a>
      </div>
    </>
  );
}
