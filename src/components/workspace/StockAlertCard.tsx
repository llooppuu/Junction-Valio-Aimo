import { Send } from 'lucide-react';
import Button from '../ui/Button.tsx';
import { formatEuro } from '../../lib/format.ts';
import { requestComposerFocus } from '../../lib/composer.ts';
import type { StockAlert } from '../../lib/types.ts';

function priceNote(delta: number, total: number): string {
  const direction = delta >= 0 ? 'more' : 'less';
  return `${formatEuro(Math.abs(delta))} ${direction} than the requested product (${formatEuro(total)} in total)`;
}

export default function StockAlertCard({ alert }: { alert: StockAlert }) {
  const { proposal } = alert;

  const askToQuote = () =>
    requestComposerFocus(
      `Quote ${proposal.quantity} packages of ${proposal.product} from ${proposal.supplier} for delivery ${proposal.delivery}, replacing ${alert.product} (${alert.id}).`,
    );

  return (
    <article className="alert-card" aria-label={`Stock alert ${alert.id}`}>
      <h3 className="alert-card__title">
        {alert.product} from {alert.supplier}: {alert.problem}.{' '}
        <span className="alert-card__id">{alert.id}</span>
      </h3>
      <p className="alert-card__usage">{alert.usage}</p>
      <p className="alert-card__proposal">
        <span className="alert-card__role">{proposal.role}</span> Proposes {proposal.product} from {proposal.supplier}:{' '}
        {proposal.quantity} packages for {formatEuro(proposal.total)}, delivered {proposal.delivery}.
      </p>
      <p className="alert-card__price">
        {priceNote(proposal.priceDelta, proposal.total)}
        {proposal.note ? `, ${proposal.note}` : ''}.
      </p>
      <div className="alert-card__actions">
        <Button size="sm" icon={<Send size={16} aria-hidden="true" />} onClick={askToQuote}>
          Ask the agent to quote it
        </Button>
        <p className="action-note">Nothing is ordered until you ask. The alert and the proposal are in the activity history.</p>
      </div>
    </article>
  );
}
