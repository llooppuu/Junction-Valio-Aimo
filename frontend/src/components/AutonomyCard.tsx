import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchAutonomy, grantAutonomy, revokeAutonomy, type AgentAutonomy, type CategoryAutonomy } from "../lib/api";
import { formatDateTime, formatEuroCents } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { categoryName } from "../lib/labels";

/** The most recent event that reset a category, for a short "why" in either language. */
function resetEvent(category: CategoryAutonomy) {
  return category.history.find((event) => event.event === "rejected" || event.event === "refused" || event.event === "revoked");
}

/**
 * Earned autonomy for this kitchen's agent: per product category, whether the
 * agent may order alone and up to what total, how close a supervised category
 * is to being earned, and the buyer's controls to grant or revoke it.
 */
export function AutonomyCard({ agentId, version, onChange }: { agentId: string; version: number; onChange: () => void }) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<AgentAutonomy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAutonomy(controller.signal)
      .then((body) => setAgent(body.agents.find((candidate) => candidate.agentId === agentId) ?? null))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("common.unknownError"));
      });
    return () => controller.abort();
  }, [agentId, version, t]);

  if (!agent) return error ? <p className="agent-error">{error}</p> : null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="autonomy-heading" className="policy-card autonomy-card">
      <div className="section-header">
        <h2 id="autonomy-heading">
          <Gauge aria-hidden="true" size={18} /> {t("autonomy.title")}
        </h2>
      </div>
      <p className="section-muted policy-intro">{t("autonomy.intro")}</p>

      {agent.mode === "limits" ? (
        <p className="section-muted">{t("autonomy.limitsMode")}</p>
      ) : (
        <>
          <p className="autonomy-rule">{t("autonomy.rule", { count: agent.approvalsToEarn })}</p>
          {agent.categories.length === 0 ? (
            <p className="section-muted">{t("autonomy.empty")}</p>
          ) : (
            <ul className="autonomy-list">
              {agent.categories.map((category) => {
                const earned = category.status === "earned";
                const reset = resetEvent(category);
                const name = categoryName(category.category);
                return (
                  <li key={category.category} className={`autonomy-row autonomy-${category.status}`}>
                    <div className="autonomy-main">
                      <span className="autonomy-name">{name}</span>
                      <span className={`autonomy-badge autonomy-badge-${category.status}`}>{t(`autonomy.status.${category.status}`)}</span>
                    </div>
                    <div className="autonomy-detail">
                      {earned ? (
                        <span>
                          {category.earnedBy === "buyer"
                            ? t("autonomy.earnedByBuyer", { amount: formatEuroCents(category.capEurCents ?? 0) })
                            : t("autonomy.earned", { amount: formatEuroCents(category.capEurCents ?? 0) })}
                        </span>
                      ) : (
                        <span className="autonomy-progress">
                          <span
                            className="autonomy-meter"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={category.approvalsToEarn}
                            aria-valuenow={Math.min(category.approvalsInRow, category.approvalsToEarn)}
                            aria-label={name}
                          >
                            <span style={{ width: `${(Math.min(category.approvalsInRow, category.approvalsToEarn) / category.approvalsToEarn) * 100}%` }} />
                          </span>
                          {t("autonomy.supervised", { done: category.approvalsInRow, needed: category.approvalsToEarn })}
                        </span>
                      )}
                      <button
                        type="button"
                        className={earned ? "button-secondary button-small" : "button-link"}
                        disabled={busy}
                        aria-label={t(earned ? "autonomy.revokeAria" : "autonomy.grantAria", { category: name })}
                        onClick={() => void act(() => (earned ? revokeAutonomy(agentId, category.category) : grantAutonomy(agentId, category.category)))}
                      >
                        {t(earned ? "autonomy.revoke" : "autonomy.grant")}
                      </button>
                    </div>
                    {category.lastReset && reset && (
                      <p className="section-muted autonomy-reset">
                        {t("autonomy.reset", { time: formatDateTime(category.lastReset.at), why: t(`autonomy.event.${reset.event as "rejected" | "refused" | "revoked"}`) })}
                      </p>
                    )}
                    <p className="section-muted autonomy-totals">
                      {t("autonomy.totals", { approvals: category.totals.approvals, rejections: category.totals.rejections, refusals: category.totals.refusals })}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error && <p className="agent-error">{error}</p>}
    </section>
  );
}
