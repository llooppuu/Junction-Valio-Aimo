import { useCallback, useEffect, useState } from "react";
import { fetchAudit, fetchQuoteAudit, type AuditEntry } from "../lib/api";
import { formatTimeSeconds } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName } from "../lib/names";

const POLL_INTERVAL_MS = 4000;

type LogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: AuditEntry[] };

interface ActivityLogProps {
  version: number;
  /** A short live feed of the latest entries, for the workspace. */
  compact?: boolean;
  /** Asks the full log to show one quote's history. `at` makes repeated requests for the same quote count. */
  focus?: { quoteId: string; at: number } | null;
  /** Opens one quote's history in the full log. Used by the compact feed. */
  onOpenQuote?: (quoteId: string) => void;
  onShowAll?: () => void;
}

const COMPACT_ENTRIES = 6;

/** The audit history in readable form: everything, or one quote's story. */
export function ActivityLog({ version, compact = false, focus = null, onOpenQuote, onShowAll }: ActivityLogProps) {
  const { t } = useI18n();
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [state, setState] = useState<LogState>({ status: "loading" });

  useEffect(() => {
    if (focus) {
      setState({ status: "loading" });
      setQuoteId(focus.quoteId);
    }
  }, [focus]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const entries = quoteId ? await fetchQuoteAudit(quoteId, signal) : await fetchAudit(signal);
        setState({ status: "ready", entries });
      } catch (error) {
        if (signal?.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : t("common.unknownError") });
      }
    },
    // t only changes with the language, which needs no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quoteId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load, version]);

  function showQuote(id: string | null) {
    if (compact && id && onOpenQuote) {
      onOpenQuote(id);
      return;
    }
    setState({ status: "loading" });
    setQuoteId(id);
  }

  if (compact) {
    const entries = state.status === "ready" ? state.entries.slice(0, COMPACT_ENTRIES) : [];
    return (
      <section aria-labelledby="live-activity-heading" className="live-activity">
        <div className="section-header activity-header">
          <h2 id="live-activity-heading">{t("activity.live")}</h2>
          {onShowAll && (
            <button type="button" className="button-link" onClick={onShowAll}>
              {t("activity.seeAll")}
            </button>
          )}
        </div>
        {state.status === "loading" && <p className="section-muted">{t("activity.loading")}</p>}
        {state.status === "error" && <p className="agent-error">{state.message}</p>}
        {state.status === "ready" && entries.length === 0 && <p className="section-muted">{t("activity.none")}</p>}
        {entries.length > 0 && (
          <ol className="activity-list activity-list-compact">
            {entries.map((entry) => (
              <li key={entry.id} className={`activity-entry activity-${entry.action.split(".")[1]}`}>
                <time dateTime={entry.at} className="activity-time">
                  {formatTimeSeconds(entry.at)}
                </time>
                <div className="activity-body">
                  <p className={`activity-actor activity-actor-${entry.actor.role}`}>{personName(entry.actor.name)}</p>
                  <p className="activity-summary">{entry.summary}</p>
                  <QuoteLinks entry={entry} current={null} onSelect={showQuote} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="activity-heading">
      <div className="section-header activity-header">
        <h2 id="activity-heading">{quoteId ? t("activity.historyOf", { id: quoteId }) : t("activity.all")}</h2>
        {quoteId && (
          <button type="button" className="button-secondary button-small" onClick={() => showQuote(null)}>
            {t("activity.showAll")}
          </button>
        )}
      </div>
      <p className="section-muted activity-intro">
        {quoteId ? t("activity.quoteIntro") : t("activity.intro")}
      </p>

      {state.status === "loading" && <p className="section-muted">{t("activity.loading")}</p>}

      {state.status === "error" && (
        <div role="alert" className="catalog-message catalog-message-error">
          <h3>{t("activity.loadFailed")}</h3>
          <p className="catalog-message-detail">{state.message}</p>
          <button type="button" onClick={() => void load()}>
            {t("common.tryAgain")}
          </button>
        </div>
      )}

      {state.status === "ready" && state.entries.length === 0 && (
        <p className="section-muted">{t("activity.none")}</p>
      )}

      {state.status === "ready" && state.entries.length > 0 && (
        <ol className="activity-list">
          {state.entries.map((entry) => (
            <li key={entry.id} className={`activity-entry activity-${entry.action.split(".")[1]}`}>
              <time dateTime={entry.at} className="activity-time">
                {formatTimeSeconds(entry.at)}
              </time>
              <div className="activity-body">
                <p className={`activity-actor activity-actor-${entry.actor.role}`}>{personName(entry.actor.name)}</p>
                <p className="activity-summary">{entry.summary}</p>
                {entry.reason && <p className="activity-reason">{entry.reason}</p>}
                <QuoteLinks entry={entry} current={quoteId} onSelect={showQuote} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

interface QuoteLinksProps {
  entry: AuditEntry;
  current: string | null;
  onSelect: (quoteId: string) => void;
}

function QuoteLinks({ entry, current, onSelect }: QuoteLinksProps) {
  const ids = [entry.quoteId, entry.relatedQuoteId].filter(
    (id): id is string => id !== undefined && id !== current,
  );
  if (ids.length === 0) return null;

  return (
    <p className="activity-links">
      {ids.map((id) => (
        <button key={id} type="button" className="activity-link" onClick={() => onSelect(id)}>
          {id}
        </button>
      ))}
    </p>
  );
}
