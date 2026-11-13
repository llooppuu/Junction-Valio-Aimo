import { useState } from 'react';
import { BellRing, Bot, Hourglass, Package, ShieldCheck } from 'lucide-react';
import PageHero from '../ui/PageHero.tsx';
import { StatCard } from '../ui/Card.tsx';
import StockAlertCard from '../workspace/StockAlertCard.tsx';
import StandingOrderPanel from '../workspace/StandingOrderPanel.tsx';
import AgentPanel from '../workspace/AgentPanel.tsx';
import {
  ApprovalsPanel,
  LiveActivityPanel,
  MandatePanel,
  RulesPanel,
  StartOverPanel,
} from '../workspace/SidePanels.tsx';
import { useDemoState } from '../../lib/demo-state.tsx';
import { formatEuro } from '../../lib/format.ts';
import { kitchens, getKitchen, standingOrders } from '../../data/mock.ts';
import type { KitchenId } from '../../lib/types.ts';
import '../../styles/workspace.css';

export default function WorkspaceView() {
  const [kitchenId, setKitchenId] = useState<KitchenId>('hotel');
  const [running, setRunning] = useState(false);
  const { quotes, orders, runs, alerts } = useDemoState();

  const kitchen = getKitchen(kitchenId);
  const kitchenQuotes = quotes.filter((quote) => quote.kitchenId === kitchenId);
  const waiting = kitchenQuotes.filter((quote) => quote.status === 'waiting');
  const kitchenOrders = orders.filter((order) => order.kitchenId === kitchenId);
  const ordersTotal = kitchenOrders.reduce((sum, order) => sum + order.total, 0);
  const kitchenRuns = runs.filter((run) => run.kitchenId === kitchenId);
  const kitchenAlerts = alerts.filter((alert) => alert.kitchenId === kitchenId);
  const standingOrder = standingOrders.find((order) => order.kitchenId === kitchenId);

  return (
    <>
      <PageHero
        title="Agent workspace"
        lead="Hand a request to a kitchen's agent and watch every API call it makes. Anything outside its rules waits for you here."
      />

      <div className="container page-body workspace">
        <div className="kitchen-switch">
          <span className="kitchen-switch__label" id="kitchen-label">
            Kitchen
          </span>
          <div className="kitchen-switch__buttons" role="group" aria-labelledby="kitchen-label">
            {kitchens.map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn btn--outline btn--sm kitchen-switch__btn"
                aria-pressed={item.id === kitchenId}
                onClick={() => setKitchenId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="kitchen-switch__note">Each kitchen has its own agent, token, and rules on the server.</p>
        </div>

        <h2 className="visually-hidden">{kitchen.name} key figures</h2>
        <div className="stat-grid">
          <StatCard
            label="Agent's spending limit"
            value={formatEuro(kitchen.spendingLimit)}
            sub={`${kitchen.name}, per quote`}
            icon={<ShieldCheck size={18} />}
          />
          <StatCard
            label="Waiting for you"
            value={waiting.length}
            sub={waiting.length === 0 ? 'Nothing to review' : `${waiting.length} to review`}
            icon={<Hourglass size={18} />}
          />
          <StatCard
            label="Orders placed"
            value={kitchenOrders.length}
            sub={`${formatEuro(ordersTotal)} in total`}
            icon={<Package size={18} />}
          />
          <StatCard
            label="Agent runs"
            value={kitchenRuns.length}
            sub={running ? 'Working' : 'Idle'}
            icon={<Bot size={18} />}
          />
        </div>

        {kitchenAlerts.length > 0 && (
          <section className="stock-alerts" aria-labelledby="stock-alerts-title">
            <h2 id="stock-alerts-title" className="stock-alerts__title">
              <BellRing size={20} aria-hidden="true" />
              {kitchenAlerts.length === 1
                ? 'Your agent noticed a stock problem'
                : `Your agent noticed ${kitchenAlerts.length} stock problems`}
            </h2>
            <div className="stock-alerts__list">
              {kitchenAlerts.map((alert) => (
                <StockAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          </section>
        )}

        {standingOrder && <StandingOrderPanel order={standingOrder} />}

        <div className="workspace__columns">
          <div className="workspace__main">
            <AgentPanel kitchen={kitchen} onRunningChange={setRunning} />
          </div>
          <aside className="workspace__side" aria-label={`${kitchen.name} approvals, rules and activity`}>
            <ApprovalsPanel kitchen={kitchen} />
            <RulesPanel kitchen={kitchen} />
            <MandatePanel kitchen={kitchen} />
            <LiveActivityPanel />
            <StartOverPanel />
          </aside>
        </div>
      </div>
    </>
  );
}
