import { useState } from 'react';
import { FileSignature, RotateCcw } from 'lucide-react';
import { Panel } from '../ui/Card.tsx';
import Button from '../ui/Button.tsx';
import ActivityFeed from '../ActivityFeed.tsx';
import { useDemoState, clockTime } from '../../lib/demo-state.tsx';
import { formatEuro } from '../../lib/format.ts';
import { hrefFor } from '../../lib/router.ts';
import type { Kitchen } from '../../lib/types.ts';

export function ApprovalsPanel({ kitchen }: { kitchen: Kitchen }) {
  const { quotes, approveQuote, rejectQuote } = useDemoState();
  const waiting = quotes.filter((quote) => quote.kitchenId === kitchen.id && quote.status === 'waiting');

  return (
    <Panel accent="none" title="Waiting for your approval">
      {waiting.length === 0 ? (
        <p>Nothing is waiting for your approval.</p>
      ) : (
        <ul className="approvals" role="list">
          {waiting.map((quote) => (
            <li key={quote.id} className="approval">
              <p className="approval__title">
                <span className="approval__id">{quote.id}</span> {quote.summary}
              </p>
              <p className="approval__meta">
                {formatEuro(quote.total)}, delivered {quote.delivery}. Needs approval: {quote.reason}.
              </p>
              <div className="approval__actions">
                <Button size="sm" onClick={() => approveQuote(quote.id)} aria-label={`Approve ${quote.id}`}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => rejectQuote(quote.id)} aria-label={`Reject ${quote.id}`}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RulesPanel({ kitchen }: { kitchen: Kitchen }) {
  return (
    <Panel accent="none" title={`${kitchen.name}'s rules`} subtitle="Held on the server. The agent cannot change them.">
      <h3 className="rules__heading rules__heading--blocked">Blocked, cannot be approved</h3>
      <ul className="rules__list">
        {kitchen.rules.blocked.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <h3 className="rules__heading rules__heading--approval">Needs your approval</h3>
      <ul className="rules__list">
        {kitchen.rules.needsApproval.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </Panel>
  );
}

export function MandatePanel({ kitchen }: { kitchen: Kitchen }) {
  const { revokedMandates, revokeMandate } = useDemoState();
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const revoked = revokedMandates.includes(kitchen.id);
  const { mandate } = kitchen;

  return (
    <Panel
      accent="none"
      titleIcon={<FileSignature size={22} />}
      title="The agent's mandate"
      subtitle="Your signed permission for the agent, a W3C Verifiable Credential. The server checks it on every request the agent makes."
    >
      <ul className="mandate__list">
        <li>Mandate {mandate.id}, signed by you</li>
        <li>Up to {formatEuro(kitchen.spendingLimit)} per quote without your approval</li>
        <li>{mandate.categories}</li>
        <li>Valid until {mandate.validUntil}</li>
        <li className="mandate__signer">Signer: {mandate.signer}</li>
      </ul>

      {revoked && <p className="mandate__status mandate__status--revoked">Revoked. The agent can no longer act.</p>}
      {!revoked && checkedAt && (
        <p className="mandate__status" role="status">
          Signature valid (Ed25519), checked at {checkedAt}.
        </p>
      )}

      <div className="mandate__actions">
        <button type="button" className="link-action" onClick={() => setCheckedAt(clockTime())} disabled={revoked}>
          Check the signature
        </button>
        <Button size="sm" variant="outline" onClick={() => revokeMandate(kitchen.id)} disabled={revoked}>
          {revoked ? 'Revoked' : 'Revoke'}
        </Button>
      </div>
    </Panel>
  );
}

export function LiveActivityPanel() {
  const { activity } = useDemoState();
  return (
    <Panel
      accent="none"
      title="Live activity"
      action={
        <a className="link-action" href={hrefFor('activity')}>
          See all
        </a>
      }
    >
      {activity.length === 0 ? (
        <p className="panel__empty">No activity yet.</p>
      ) : (
        <ActivityFeed entries={activity.slice(0, 6)} variant="compact" />
      )}
    </Panel>
  );
}

export function StartOverPanel() {
  const { reset } = useDemoState();
  const [cleared, setCleared] = useState(false);
  return (
    <section className="start-over" aria-labelledby="start-over-title">
      <h2 id="start-over-title" className="start-over__title">
        Start over
      </h2>
      <p className="start-over__text">
        Clears quotes, orders, alerts, and agent runs. Prices and stock come live from Valio Aimo and cannot be set here.
      </p>
      <Button
        variant="danger"
        size="sm"
        icon={<RotateCcw size={16} aria-hidden="true" />}
        onClick={() => {
          reset();
          setCleared(true);
        }}
      >
        Start over
      </Button>
      {cleared && (
        <p className="start-over__done" role="status">
          Cleared. Reload the page to bring back the sample data.
        </p>
      )}
    </section>
  );
}
