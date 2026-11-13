import { getKitchen } from '../data/mock.ts';
import type { ActivityEntry } from '../lib/types.ts';
import '../styles/activity.css';

interface ActivityFeedProps {
  entries: ActivityEntry[];
  /** "compact" for side panels; "full" adds the detail line and a coloured edge for alerts. */
  variant?: 'compact' | 'full';
  /** Show the kitchen after the agent's name (wholesaler view). */
  showKitchen?: boolean;
  /** Makes quote and alert references clickable. */
  onSelectRef?: (ref: string) => void;
  selectedRef?: string | null;
}

function actorName(entry: ActivityEntry): string {
  const kitchen = getKitchen(entry.kitchenId);
  return entry.actor === 'agent' ? kitchen.agentName : `Head chef, ${kitchen.name.toLowerCase()}`;
}

export default function ActivityFeed({
  entries,
  variant = 'full',
  showKitchen = false,
  onSelectRef,
  selectedRef,
}: ActivityFeedProps) {
  return (
    <ol className={`feed feed--${variant}`}>
      {entries.map((entry) => {
        const ref = entry.ref;
        const hasRefPrefix = ref !== undefined && entry.text.startsWith(ref);
        const rest = hasRefPrefix && ref ? entry.text.slice(ref.length) : entry.text;
        return (
          <li key={entry.id} className={`feed__item feed__item--${entry.kind}`}>
            <time className="feed__time">{entry.time}</time>
            <div className="feed__body">
              <p className="feed__actor">
                {actorName(entry)}
                {showKitchen && ` · ${getKitchen(entry.kitchenId).name}`}
              </p>
              <p className="feed__text">
                {hasRefPrefix && ref && onSelectRef ? (
                  <>
                    <button
                      type="button"
                      className="feed__ref"
                      aria-pressed={selectedRef === ref}
                      title={`Show the history of ${ref}`}
                      onClick={() => onSelectRef(ref)}
                    >
                      {ref}
                    </button>
                    {rest}
                  </>
                ) : (
                  entry.text
                )}
              </p>
              {variant === 'full' && <p className="feed__detail">{entry.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
