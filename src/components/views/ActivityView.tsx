import { useState } from 'react';
import PageHero from '../ui/PageHero.tsx';
import { EmptyState } from '../ui/Card.tsx';
import Button from '../ui/Button.tsx';
import ActivityFeed from '../ActivityFeed.tsx';
import { useDemoState } from '../../lib/demo-state.tsx';

export default function ActivityView() {
  const { activity } = useDemoState();
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const entries = selectedRef ? activity.filter((entry) => entry.ref === selectedRef) : activity;
  const selectRef = (ref: string) => setSelectedRef((current) => (current === ref ? null : ref));

  return (
    <>
      <PageHero title="Activity" lead="The append-only audit history: who did what, and why." />

      <div className="container page-body activity-page">
        <h2 className="section-title">All activity</h2>
        <p className="section-intro">
          What the agent and the buyer did, and why, newest first. Select a quote to see its history.
        </p>

        {selectedRef && (
          <div className="activity-page__filter" role="status">
            <p>
              Showing the history of <strong>{selectedRef}</strong>: {entries.length}{' '}
              {entries.length === 1 ? 'entry' : 'entries'}.
            </p>
            <Button variant="outline" size="sm" onClick={() => setSelectedRef(null)}>
              Show all
            </Button>
          </div>
        )}

        <div className="activity-page__list">
          {entries.length === 0 ? (
            <EmptyState title="No activity yet">Requests to the agent and your approvals appear here.</EmptyState>
          ) : (
            <ActivityFeed entries={entries} onSelectRef={selectRef} selectedRef={selectedRef} />
          )}
        </div>
      </div>
    </>
  );
}
