import { useCallback, useEffect, useState } from "react";
import { decideQuote, fetchQuotes, type Quote, type SupplierReliability } from "../lib/api";
import { formatDeliveryDate, formatEuroCents, formatPackages, formatQuantity } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName, productName } from "../lib/names";
import { GuardrailChecks } from "./PolicyCard";
import { AlternativesList } from "./Alternatives";
import { QuotePlan } from "./MenuPlanTable";
import { QuoteStandingOrder } from "./StandingOrder";
import { permissionReason } from "../lib/reasons";
import { RiskNote } from "./Risk";

const POLL_INTERVAL_MS = 4000;

type QueueState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; quotes: Quote[] };

interface ApprovalQueueProps {
  /** Changes whenever something may have changed, to reload at once. */
  version: number;
  onDecision: () => void;
  /** Each supplier's reliability, for the delivery risk warnings. */
  reliability: Map<string, SupplierReliability>;
}

export function ApprovalQueue({ version, onDecision, reliability }: ApprovalQueueProps) {
  const { t } = useI18n();
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const quotes = await fetchQuotes(signal);
      setState({ status: "ready", quotes: quotes.filter((quote) => quote.status === "needs_approval") });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: "error", message: error instanceof Error ? error.message : t("common.unknownError") });
    }
    // t only changes with the language, which needs no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agents create quotes at any time, so the queue checks for new ones regularly.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load, version]);

  async function decide(quote: Quote, decision: "approve" | "reject") {
    setBusyQuoteId(quote.id);
    try {
      const updated = await decideQuote(quote.id, decision);
      setNotice(t(updated.status === "approved" ? "approvals.approved" : "approvals.rejected", { id: updated.id }));
    } catch (error) {
      setNotice(`${quote.id}: ${error instanceof Error ? error.message : t("approvals.failed")}`);
    } finally {
      setBusyQuoteId(null);
      onDecision();
    }
  }

  return (
    <section aria-labelledby="approvals-heading" className="approvals">
      <div className="section-header">
        <h2 id="approvals-heading">{t("approvals.title")}</h2>
        {state.status === "ready" && state.quotes.length > 0 && (
          <p className="section-count">{state.quotes.length}</p>
        )}
      </div>

      {notice && (
        <p role="status" className="approval-notice">
          {notice}
        </p>
      )}

      {state.status === "loading" && <p className="section-muted">{t("approvals.checking")}</p>}

      {state.status === "error" && (
        <div role="alert" className="catalog-message catalog-message-error">
          <h3>{t("approvals.loadFailed")}</h3>
          <p className="catalog-message-detail">{state.message}</p>
          <button type="button" onClick={() => void load()}>
            {t("common.tryAgain")}
          </button>
        </div>
      )}

      {state.status === "ready" && state.quotes.length === 0 && (
        <p className="section-muted">{t("approvals.none")}</p>
      )}

      {state.status === "ready" && state.quotes.length > 0 && (
        <ul className="approval-list">
          {state.quotes.map((quote) => (
            <li key={quote.id}>
              <ApprovalCard
                quote={quote}
                reliability={reliability}
                busy={busyQuoteId === quote.id}
                onDecide={(decision) => void decide(quote, decision)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ApprovalCardProps {
  quote: Quote;
  reliability: Map<string, SupplierReliability>;
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
}

function ApprovalCard({ quote, reliability, busy, onDecide }: ApprovalCardProps) {
  const { t } = useI18n();
  const suppliers = [...new Set(quote.lines.map((line) => line.supplier))];
  const { limitEurCents } = quote.permission;

  return (
    <article className="approval-card" aria-labelledby={`quote-${quote.id}`}>
      <header className="approval-card-header">
        <div>
          <h3 id={`quote-${quote.id}`}>{t("approvals.quote", { id: quote.id })}</h3>
          <p className="section-muted">
            {t("approvals.from", { name: personName(quote.createdBy.name) })}
            {quote.replacesQuoteId && <> · {t("approvals.replaces", { id: quote.replacesQuoteId })}</>}
          </p>
        </div>
        <div className="approval-total">
          <span className="approval-total-amount">{formatEuroCents(quote.totalEurCents)}</span>
          {limitEurCents !== null && <span>{t("approvals.limit", { amount: formatEuroCents(limitEurCents) })}</span>}
        </div>
      </header>

      <p className="approval-reason">{permissionReason(quote)}</p>
      <GuardrailChecks checks={quote.permission.checks ?? []} />
      {suppliers.map((supplier) =>
        reliability.has(supplier) ? <RiskNote key={supplier} reliability={reliability.get(supplier)!} /> : null,
      )}

      <table className="approval-lines">
        <thead>
          <tr>
            <th scope="col">{t("col.product")}</th>
            <th scope="col">{t("col.quantity")}</th>
            <th scope="col">{t("col.delivery")}</th>
            <th scope="col">{t("col.total")}</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.productId}>
              <td>
                {productName(line.productId, line.productName)}
                <span className="approval-supplier">{line.supplier}</span>
              </td>
              <td>
                {formatPackages(line.packages)}
                <span className="approval-supplier">{formatQuantity(line.quantity.amount, line.quantity.unit)}</span>
              </td>
              <td>{formatDeliveryDate(line.deliveryDate)}</td>
              <td>{formatEuroCents(line.lineTotalEurCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <QuoteStandingOrder review={quote.standingOrder} />
      <QuotePlan plan={quote.plan} />
      <AlternativesList alternatives={quote.alternatives} />

      <div className="approval-actions">
        <button type="button" className="button-primary" disabled={busy} onClick={() => onDecide("approve")}>
          {t("approvals.approve")}
        </button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => onDecide("reject")}>
          {t("approvals.reject")}
        </button>
      </div>
    </article>
  );
}
