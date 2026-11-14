import { FileKey, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchMandates, issueMandate, revokeMandate, verifyMandate, type Mandate, type MandateCheck } from "../lib/api";
import { formatDateTime, formatEuroCents, formatLongDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { CATEGORIES, categoryName } from "../lib/labels";

/** The start and end of a long identifier, so the issuer's DID fits on a line. */
const shorten = (text: string) => (text.length > 28 ? `${text.slice(0, 16)}…${text.slice(-8)}` : text);

/**
 * The buyer's signed mandate for this kitchen's agent: what the agent may do,
 * until when, and who signed it. The buyer can check the signature, revoke the
 * mandate to stop the agent at once, and issue a new one.
 */
export function MandateCard({ agentId, version, onChange }: { agentId: string; version: number; onChange: () => void }) {
  const { t, tn } = useI18n();
  const [mandates, setMandates] = useState<Mandate[] | null>(null);
  const [check, setCheck] = useState<MandateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMandates(controller.signal)
      .then((body) => setMandates(body.mandates.filter((mandate) => mandate.agentId === agentId)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("common.unknownError"));
      });
    return () => controller.abort();
  }, [agentId, version, t]);

  useEffect(() => setCheck(null), [agentId, version]);

  if (!mandates) return null;
  // The list is newest first: the one in force, or else the last one, which explains why the agent is stopped.
  const mandate = mandates.find((candidate) => candidate.status === "active") ?? mandates[0];

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
    <section aria-labelledby="mandate-heading" className="policy-card mandate-card">
      <div className="section-header">
        <h2 id="mandate-heading">
          <FileKey aria-hidden="true" size={18} /> {t("mandate.title")}
        </h2>
      </div>
      <p className="section-muted policy-intro">{t("mandate.intro")}</p>

      {!mandate || mandate.status !== "active" ? (
        <p className="mandate-stopped" role="status">
          {mandate?.status === "revoked" ? t("mandate.revoked", { id: mandate.id, time: formatDateTime(mandate.revokedAt ?? "") }) : t("mandate.none")}
        </p>
      ) : (
        <ul className="policy-rules mandate-terms">
          <li>{t("mandate.id", { id: mandate.id })}</li>
          <li>{t("mandate.limit", { amount: formatEuroCents(mandate.spendingLimitEurCents) })}</li>
          <li>
            {CATEGORIES.every((category) => mandate.allowedCategories.includes(category))
              ? t("mandate.allCategories")
              : t("mandate.categories", { list: mandate.allowedCategories.map(categoryName).join(", ") })}
          </li>
          <li>{t("mandate.until", { date: formatLongDate(mandate.expiresAt.slice(0, 10)) })}</li>
          <li className="mandate-issuer" title={mandate.issuer}>
            {t("mandate.issuer", { did: shorten(mandate.issuer) })}
          </li>
        </ul>
      )}

      {check && (
        <p className={`signed-offer-result ${check.valid && check.status === "active" ? "signed-offer-valid" : "signed-offer-invalid"}`} role="status">
          {check.valid && check.status === "active" ? <ShieldCheck aria-hidden="true" size={15} /> : <ShieldAlert aria-hidden="true" size={15} />}
          {check.valid ? t(`mandate.check.${check.status}`) : t("mandate.check.invalid", { reason: check.reason ?? "" })}
        </p>
      )}
      {error && <p className="agent-error">{error}</p>}

      <div className="mandate-actions">
        {mandate && (
          <button type="button" className="button-link" disabled={busy} onClick={() => void verifyMandate(mandate.token).then(setCheck, (reason: unknown) => setError(String(reason)))}>
            {t("mandate.verify")}
          </button>
        )}
        {mandate?.status === "active" ? (
          <button type="button" className="button-secondary button-small" disabled={busy} onClick={() => void act(() => revokeMandate(mandate.id))}>
            {t("mandate.revoke")}
          </button>
        ) : (
          <button type="button" className="button-primary button-small" disabled={busy} onClick={() => void act(() => issueMandate(agentId))}>
            {t("mandate.issue")}
          </button>
        )}
      </div>
      {mandates.length > 1 && <p className="section-muted mandate-history">{tn("mandate.history.one", mandates.length - 1)}</p>}
    </section>
  );
}
