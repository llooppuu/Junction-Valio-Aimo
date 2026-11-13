import { AlertOctagon, Hourglass, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchWholesalerActivity, fetchWholesalerSuggestions, type Suggestion, type WholesalerActivity } from "../lib/api";
import { formatEuroCents, formatTimeSeconds } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName } from "../lib/names";
import { SalesAgentCard } from "./Suggestions";

const POLL_INTERVAL_MS = 4000;

type ViewState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; activity: WholesalerActivity };

/**
 * The wholesaler's side of the audit trail: every buyer's agents in one place,
 * with what waits for a buyer and every attempt that was refused or blocked.
 * It uses its own role, so the buyer's app cannot see other buyers' activity.
 */
export function WholesalerView({ version, onChange }: { version: number; onChange: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchWholesalerActivity(controller.signal)
        .then(async (activity) => {
          setState({ status: "ready", activity });
          setSuggestions(await fetchWholesalerSuggestions(controller.signal));
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : t("common.unknownError") });
        });
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
    // t only changes with the language, which needs no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (state.status === "loading") return <p className="section-muted">{t("wh.loading")}</p>;
  if (state.status === "error") return <p className="agent-error">{state.message}</p>;
  const { agents, waiting, attention, entries } = state.activity;

  return (
    <div className="wholesaler">
      <p className="section-muted section-note">{t("wh.note")}</p>

      <SalesAgentCard suggestions={suggestions} onRun={onChange} />

      <section aria-labelledby="wholesale-agents">
        <h2 id="wholesale-agents" className="wholesale-heading">
          {t("wh.agents")}
        </h2>
        <div className="wholesale-table-wrap">
          <table className="wholesale-table">
            <thead>
              <tr>
                <th scope="col">{t("wh.col.buyer")}</th>
                <th scope="col">{t("wh.col.quotes")}</th>
                <th scope="col">{t("wh.col.within")}</th>
                <th scope="col">{t("wh.col.waiting")}</th>
                <th scope="col">{t("wh.col.decided")}</th>
                <th scope="col">{t("wh.col.orders")}</th>
                <th scope="col">{t("wh.col.blocked")}</th>
                <th scope="col">{t("wh.col.refused")}</th>
                <th scope="col">{t("wh.col.denied")}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agentId}>
                  <th scope="row">
                    {personName(agent.buyerName)}
                    <span className="approval-supplier">{personName(agent.agentName)}</span>
                  </th>
                  <td>{agent.quotes}</td>
                  <td>{agent.withinLimit}</td>
                  <td className={agent.waitingForApproval > 0 ? "cell-attention" : undefined}>{agent.waitingForApproval}</td>
                  <td>
                    {agent.approved} / {agent.rejected}
                  </td>
                  <td>
                    {agent.orders}
                    <span className="approval-supplier">{formatEuroCents(agent.orderValueEurCents)}</span>
                  </td>
                  <td className={agent.blocked > 0 ? "cell-danger" : undefined}>{agent.blocked}</td>
                  <td className={agent.refused + agent.toolRefused > 0 ? "cell-danger" : undefined}>{agent.refused + agent.toolRefused}</td>
                  <td className={agent.accessDenied > 0 ? "cell-danger" : undefined}>{agent.accessDenied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dashboard-grid wholesale-grid">
        <section className="dash-card dash-attention" aria-labelledby="wholesale-waiting">
          <header className="dash-card-header">
            <div>
              <h2 id="wholesale-waiting">{t("wh.waiting")}</h2>
              <p className="section-muted">{t("wh.waitingNote")}</p>
            </div>
            <Hourglass aria-hidden="true" size={20} className="stat-icon" />
          </header>
          {waiting.length === 0 ? (
            <p className="dash-empty">{t("wh.nothingWaiting")}</p>
          ) : (
            <ul className="dash-list">
              {waiting.map((item) => (
                <li key={item.quoteId} className="dash-row wholesale-row">
                  <span className="dash-row-main">
                    <strong>{item.quoteId}</strong> · {item.buyerName ? personName(item.buyerName) : ""}
                    <span className="dash-row-sub">{item.reason}</span>
                  </span>
                  <span className="dash-row-amount">{formatEuroCents(item.totalEurCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card" aria-labelledby="wholesale-attention">
          <header className="dash-card-header">
            <div>
              <h2 id="wholesale-attention">{t("wh.refused")}</h2>
              <p className="section-muted">{t("wh.refusedNote")}</p>
            </div>
            <ShieldAlert aria-hidden="true" size={20} className="stat-icon" />
          </header>
          {attention.length === 0 ? (
            <p className="dash-empty">{t("wh.noAttempts")}</p>
          ) : (
            <ul className="dash-list">
              {attention.slice(0, 8).map((entry) => (
                <li key={entry.id} className="dash-row wholesale-row">
                  <span className="dash-row-main">
                    <strong>
                      <AlertOctagon aria-hidden="true" size={13} /> {entry.action}
                    </strong>{" "}
                    · {personName(entry.buyerName ?? entry.actor.name)}
                    <span className="dash-row-sub">{entry.reason ?? entry.summary}</span>
                  </span>
                  <span className="dash-row-amount wholesale-time">{formatTimeSeconds(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="wholesale-log" className="wholesale-log">
        <h2 id="wholesale-log" className="wholesale-heading">
          {t("wh.log")}
        </h2>
        <ol className="activity-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`activity-entry activity-${entry.action.split(".")[1]}`}>
              <time dateTime={entry.at} className="activity-time">
                {formatTimeSeconds(entry.at)}
              </time>
              <div className="activity-body">
                <p className={`activity-actor activity-actor-${entry.actor.role}`}>
                  {personName(entry.actor.name)}
                  {entry.buyerName ? ` · ${personName(entry.buyerName)}` : ""}
                </p>
                <p className="activity-summary">{entry.summary}</p>
                {entry.reason && <p className="activity-reason">{entry.reason}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
