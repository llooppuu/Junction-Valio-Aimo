import { CalendarSync, Send } from 'lucide-react';
import { Panel } from '../ui/Card.tsx';
import Badge from '../ui/Badge.tsx';
import Button from '../ui/Button.tsx';
import { analyzeStandingOrder } from '../../lib/standing-order.ts';
import { formatChange, formatEuro, formatPercent, formatQuantity } from '../../lib/format.ts';
import { requestComposerFocus } from '../../lib/composer.ts';
import type { StandingOrder } from '../../lib/types.ts';

interface SparkProps {
  history: number[];
  renewal: number;
  drifted: boolean;
  label: string;
}

/** Weekly quantities as small bars, with the renewal as the last, darker bar. */
function Spark({ history, renewal, drifted, label }: SparkProps) {
  const max = Math.max(renewal, ...history) || 1;
  const height = (value: number) => `${Math.max(12, (value / max) * 100)}%`;
  return (
    <span className="spark" role="img" aria-label={label}>
      {history.map((value, week) => (
        <span key={week} className="spark__bar" style={{ height: height(value) }} />
      ))}
      <span
        className={`spark__bar spark__bar--renewal${drifted ? ' spark__bar--drift' : ''}`}
        style={{ height: height(renewal) }}
      />
    </span>
  );
}

export default function StandingOrderPanel({ order }: { order: StandingOrder }) {
  const analysis = analyzeStandingOrder(order);
  const limit = formatPercent(order.driftLimit);
  const weeks = order.lines[0]?.history.length ?? 0;

  const askToRenew = () =>
    requestComposerFocus(`Renew the ${order.title.toLowerCase()} for ${order.deliveryDate}.`);

  return (
    <Panel
      accent="accent"
      className="standing-order"
      titleIcon={<CalendarSync size={22} />}
      title="Weekly standing order"
      subtitle={`${order.title} for ${order.deliveryDate}, compared with the last ${weeks} weeks before it renews. A line or total more than ${limit} from the average needs your approval.`}
      action={
        analysis.drifted ? <Badge tone="drift">Drift detected</Badge> : <Badge tone="ok">Within {limit}</Badge>
      }
    >
      <div className="table-wrap">
        <table className="data-table standing-order__table">
          <caption className="visually-hidden">
            {order.title}: quantities for the last {weeks} weeks, their average and the renewal
          </caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="standing-order__spark-col">
                Last {weeks} weeks
              </th>
              <th scope="col" className="num">
                Average
              </th>
              <th scope="col" className="num">
                Renewal
              </th>
              <th scope="col" className="num">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {analysis.lines.map((line) => (
              <tr key={line.product} className={line.drifted ? 'is-drift' : undefined}>
                <th scope="row">{line.product}</th>
                <td className="standing-order__spark-col">
                  <Spark
                    history={line.history}
                    renewal={line.renewal}
                    drifted={line.drifted}
                    label={`Weekly quantities: ${line.history.join(', ')}; renewal ${line.renewal}`}
                  />
                </td>
                <td className="num">{formatQuantity(line.average)}</td>
                <td className="num">{line.renewal}</td>
                <td className="num standing-order__change">{formatChange(line.change)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={analysis.totalDrifted ? 'is-drift' : undefined}>
              <th scope="row">Total at today's prices</th>
              <td className="standing-order__spark-col">
                <Spark
                  history={analysis.totalHistory}
                  renewal={analysis.renewalTotal}
                  drifted={analysis.totalDrifted}
                  label="Weekly totals at today's prices"
                />
              </td>
              <td className="num">{formatEuro(analysis.averageTotal)}</td>
              <td className="num">{formatEuro(analysis.renewalTotal)}</td>
              <td className="num">{formatChange(analysis.totalChange)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="standing-order__actions">
        <Button size="sm" icon={<Send size={16} aria-hidden="true" />} onClick={askToRenew}>
          Ask the agent to renew it
        </Button>
        <p className="action-note">
          A drifted renewal waits for your approval. Within {limit}, the agent may renew it on its own.
        </p>
      </div>
    </Panel>
  );
}
