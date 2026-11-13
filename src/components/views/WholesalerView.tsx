import { Check, Hourglass, Megaphone, ShieldAlert, X } from 'lucide-react';
import PageHero from '../ui/PageHero.tsx';
import Button from '../ui/Button.tsx';
import { Panel } from '../ui/Card.tsx';
import ActivityFeed from '../ActivityFeed.tsx';
import { useDemoState } from '../../lib/demo-state.tsx';
import { formatEuro } from '../../lib/format.ts';
import { getKitchen, kitchens, seasonalSuggestions } from '../../data/mock.ts';
import type { ActivityKind } from '../../lib/types.ts';
import '../../styles/wholesaler.css';

const OUTSIDE_RULES: ActivityKind[] = ['blocked', 'refused', 'denied'];

export default function WholesalerView() {
  const { quotes, orders, activity, suggestionsSent, sendSuggestions } = useDemoState();

  const waiting = quotes.filter((quote) => quote.status === 'waiting');
  const outside = activity.filter((entry) => OUTSIDE_RULES.includes(entry.kind));

  const rows = kitchens.map((kitchen) => {
    const own = quotes.filter((quote) => quote.kitchenId === kitchen.id);
    const ownOrders = orders.filter((order) => order.kitchenId === kitchen.id);
    const ownActivity = activity.filter((entry) => entry.kitchenId === kitchen.id);
    const count = (kind: ActivityKind) => ownActivity.filter((entry) => entry.kind === kind).length;
    return {
      kitchen,
      quotes: own.length,
      withinRules: own.filter((quote) => quote.withinRules).length,
      waiting: own.filter((quote) => quote.status === 'waiting').length,
      approved: own.filter((quote) => quote.status === 'approved').length,
      rejected: own.filter((quote) => quote.status === 'rejected').length,
      orders: ownOrders.length,
      ordersTotal: ownOrders.reduce((sum, order) => sum + order.total, 0),
      blocked: count('blocked'),
      refused: count('refused'),
      denied: count('denied'),
    };
  });

  return (
    <>
      <PageHero
        title="Wholesaler view"
        lead="What the wholesaler sees: every buyer's agents, what waits for a buyer, and every attempt outside the rules."
      />

      <div className="container page-body wholesaler">
        <p className="wholesaler__note">
          Signed in here as the wholesaler's operations team, with a role of its own. The buyer's app cannot see this
          page's data.
        </p>

        <Panel
          accent="accent"
          className="sales-agent"
          title="Sales agent"
          subtitle="Suggests new and seasonal products to every buyer's agent. Each buyer's agent screens them against its own rules."
          action={
            <Button
              variant="accent"
              icon={<Megaphone size={18} aria-hidden="true" />}
              onClick={sendSuggestions}
              disabled={suggestionsSent}
            >
              Suggest this season's products
            </Button>
          }
        >
          {!suggestionsSent ? (
            <p>No suggestions sent yet.</p>
          ) : (
            <ul className="suggestions" role="list">
              {seasonalSuggestions.map((suggestion) => (
                <li key={suggestion.product} className="suggestion">
                  <div className="suggestion__product">
                    <p className="suggestion__name">{suggestion.product}</p>
                    <p className="suggestion__meta">
                      {suggestion.supplier} · {suggestion.why}
                    </p>
                  </div>
                  <ul className="suggestion__screening" role="list">
                    {kitchens.map((kitchen) => {
                      const result = suggestion.screening[kitchen.id];
                      return (
                        <li key={kitchen.id} className={result.accepted ? 'is-accepted' : 'is-declined'}>
                          {result.accepted ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                          <span>
                            <strong>{kitchen.name}:</strong> {result.reason}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <section className="wholesaler__section" aria-labelledby="by-buyer-title">
          <h2 id="by-buyer-title" className="section-title">
            Agents by buyer
          </h2>
          <div className="table-wrap buyers">
            <table className="data-table buyers__table">
              <caption className="visually-hidden">Quotes, orders and attempts outside the rules for each buyer</caption>
              <thead>
                <tr>
                  <th scope="col">Buyer and agent</th>
                  <th scope="col" className="num">
                    Quotes
                  </th>
                  <th scope="col" className="num">
                    Within rules
                  </th>
                  <th scope="col" className="num">
                    Waiting
                  </th>
                  <th scope="col" className="num">
                    Approved / rejected
                  </th>
                  <th scope="col" className="num">
                    Orders
                  </th>
                  <th scope="col" className="num">
                    Blocked
                  </th>
                  <th scope="col" className="num">
                    Refused
                  </th>
                  <th scope="col" className="num">
                    Denied
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.kitchen.id}>
                    <th scope="row">
                      <span className="buyers__name">{row.kitchen.name}</span>
                      <span className="buyers__agent">{row.kitchen.agentName}</span>
                    </th>
                    <td className="num" data-label="Quotes">
                      {row.quotes}
                    </td>
                    <td className="num" data-label="Within rules">
                      {row.withinRules}
                    </td>
                    <td className="num" data-label="Waiting">
                      {row.waiting}
                    </td>
                    <td className="num" data-label="Approved / rejected">
                      {row.approved} / {row.rejected}
                    </td>
                    <td className="num" data-label="Orders">
                      <span>
                        {row.orders}
                        <span className="buyers__sum">{formatEuro(row.ordersTotal)}</span>
                      </span>
                    </td>
                    <td className="num" data-label="Blocked">
                      {row.blocked}
                    </td>
                    <td className="num" data-label="Refused">
                      {row.refused}
                    </td>
                    <td className="num" data-label="Denied">
                      {row.denied}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="wholesaler__pair">
          <Panel
            accent="accent"
            title="Waiting for a buyer"
            subtitle="Quotes the agents may not order alone"
            icon={<Hourglass size={20} />}
          >
            {waiting.length === 0 ? (
              <p>Nothing is waiting.</p>
            ) : (
              <ul className="wholesaler__list" role="list">
                {waiting.map((quote) => (
                  <li key={quote.id}>
                    <p>
                      <span className="wholesaler__id">{quote.id}</span> {quote.summary}
                    </p>
                    <p className="wholesaler__meta">
                      {getKitchen(quote.kitchenId).name} · {formatEuro(quote.total)} · {quote.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Refused and blocked"
            subtitle="Every attempt outside an agent's rules"
            icon={<ShieldAlert size={20} />}
          >
            {outside.length === 0 ? (
              <p>No attempts outside the rules.</p>
            ) : (
              <ul className="wholesaler__list" role="list">
                {outside.map((entry) => (
                  <li key={entry.id}>
                    <p>{entry.text}</p>
                    <p className="wholesaler__meta">
                      {getKitchen(entry.kitchenId).name} · {entry.time}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <section className="wholesaler__section" aria-labelledby="all-activity-title">
          <h2 id="all-activity-title" className="section-title">
            All activity across buyers
          </h2>
          <div className="wholesaler__feed">
            {activity.length === 0 ? (
              <p className="panel__empty">No activity yet.</p>
            ) : (
              <ActivityFeed entries={activity} showKitchen />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
