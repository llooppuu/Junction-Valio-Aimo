import { Megaphone, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { dismissSuggestion, runSalesAgent, type Suggestion } from "../lib/api";
import { formatEuroCents } from "../lib/format";
import { tr, useI18n } from "../lib/i18n";
import { personName, pitchText, productName } from "../lib/names";

/** What the agent is asked when the buyer wants a suggestion quoted, in the buyer's language. */
export function suggestionRequest(suggestion: Suggestion): string {
  return tr("sugg.request", { id: suggestion.id, product: productName(suggestion.productId, suggestion.productName) });
}

/** The buyer's agent's verdict, in the interface's language when it is Finnish. */
function verdict(suggestion: Suggestion, perspective: "buyer" | "wholesaler" = "buyer"): string {
  return suggestion.screening.suitable ? tr(perspective === "buyer" ? "sugg.suitable" : "sugg.suitableBuyer") : tr("sugg.heldBackReason", { reason: suggestion.screening.reason.replace(/^Held back: /, "") });
}

/**
 * Suggestions from the wholesaler's sales agent that this kitchen's agent
 * passed on, each with the reason it suits the buyer. Held-back suggestions
 * stay folded away with their reasons, so the buyer can see what was filtered.
 */
export function SuggestionsPanel({
  suggestions,
  agentAvailable,
  onAsk,
  onChange,
}: {
  suggestions: Suggestion[];
  agentAvailable: boolean;
  onAsk: (suggestion: Suggestion) => void;
  onChange: () => void;
}) {
  const { t, tn, language } = useI18n();
  const passed = suggestions.filter((suggestion) => suggestion.status === "suggested");
  const heldBack = suggestions.filter((suggestion) => suggestion.status === "held_back");
  if (passed.length === 0 && heldBack.length === 0) return null;

  return (
    <section className="suggestions" aria-labelledby="suggestions-heading">
      <h2 id="suggestions-heading" className="stock-alerts-heading">
        <Sparkles aria-hidden="true" size={20} />
        {t("sugg.title")}
      </h2>
      <p className="section-muted">{t("sugg.intro")}</p>
      {passed.length > 0 && (
        <ul className="suggestion-list">
          {passed.map((suggestion) => (
            <li key={suggestion.id} className="suggestion-card">
              <p className="suggestion-top">
                <span className={`suggestion-kind suggestion-kind-${suggestion.kind}`}>{t(`sugg.kind.${suggestion.kind}`)}</span>
                <span className="stock-alert-id">{suggestion.id}</span>
              </p>
              <h3 className="suggestion-name">{productName(suggestion.productId, suggestion.productName)}</h3>
              <p className="approval-supplier">
                {suggestion.supplier} · {formatEuroCents(suggestion.pricePerPackageEurCents)} {t("product.perPackage")}
              </p>
              <p className="suggestion-pitch">
                <Megaphone aria-hidden="true" size={15} /> “{pitchText(suggestion.productId, suggestion.pitch)}”
              </p>
              <p className="suggestion-verdict" title={language === "en" ? undefined : suggestion.screening.reason}>
                {language === "en" ? suggestion.screening.reason : verdict(suggestion)}
              </p>
              <div className="suggestion-actions">
                <button type="button" className="button-primary button-icon button-small" disabled={!agentAvailable} onClick={() => onAsk(suggestion)}>
                  <Send aria-hidden="true" size={16} />
                  {t("sugg.ask")}
                </button>
                <button
                  type="button"
                  className="button-secondary button-icon button-small"
                  onClick={() => void dismissSuggestion(suggestion.id).then(onChange)}
                >
                  <X aria-hidden="true" size={16} />
                  {t("sugg.dismiss")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {heldBack.length > 0 && (
        <details className="alternatives">
          <summary>{tn("sugg.heldBack.one", heldBack.length)}</summary>
          <ul className="suggestion-held">
            {heldBack.map((suggestion) => (
              <li key={suggestion.id}>
                <strong>{productName(suggestion.productId, suggestion.productName)}</strong>: {verdict(suggestion)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="section-muted suggestion-note">{t("sugg.note")}</p>
    </section>
  );
}

/** On the wholesaler's side: run the sales agent and see each buyer's agent's verdict. */
export function SalesAgentCard({ suggestions, onRun }: { suggestions: Suggestion[]; onRun: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const sent = await runSalesAgent();
      setNotice(t("sales.sent", { count: sent }));
      onRun();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card sales-agent" aria-labelledby="sales-agent-heading">
      <header className="dash-card-header">
        <div>
          <h2 id="sales-agent-heading">{t("sales.title")}</h2>
          <p className="section-muted">{t("sales.intro")}</p>
        </div>
        <button type="button" className="button-cta button-icon" disabled={busy} onClick={() => void run()}>
          <Megaphone aria-hidden="true" size={18} />
          {t("sales.run")}
        </button>
      </header>
      {notice && (
        <p role="status" className="approval-notice">
          {notice}
        </p>
      )}
      {suggestions.length === 0 ? (
        <p className="dash-empty">{t("sales.none")}</p>
      ) : (
        <ul className="dash-list">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="dash-row wholesale-row">
              <span className="dash-row-main">
                <strong>{suggestion.id}</strong> · {productName(suggestion.productId, suggestion.productName)} → {personName(suggestion.buyerName)}
                <span className="dash-row-sub">{verdict(suggestion, "wholesaler")}</span>
              </span>
              <span className={`sales-status sales-status-${suggestion.status}`}>{t(`sales.status.${suggestion.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
