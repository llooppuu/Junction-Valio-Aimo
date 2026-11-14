import { ArrowLeftRight, Ban, X } from "lucide-react";
import { useRef, useState } from "react";
import { fetchProduct, fetchSubstitutes, type Product, type SubstitutesResult } from "../lib/api";
import { formatDeliveryDate, formatEuroCents, formatPackages, formatQuantity, formatPercent } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/messages";
import { productName } from "../lib/names";
import { serverPhrase } from "../lib/reasons";

type DialogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: SubstitutesResult; products: Map<string, Product> };

/**
 * On a product that cannot be ordered, opens a dialog that sets the requested
 * product beside each substitute, like the substitution dialog in our 2025
 * project. The server picks and ranks the substitutes; the dialog only shows them.
 */
export function SubstitutesPanel({ product }: { product: Product }) {
  const { t } = useI18n();
  const name = productName(product.id, product.name);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<DialogState>({ status: "loading" });
  const rates = state.status === "ready" ? state.products : new Map<string, Product>();

  async function open() {
    dialogRef.current?.showModal();
    setState({ status: "loading" });
    try {
      // Each proposed substitute's own live details, such as its delivery reliability.
      const result = await fetchSubstitutes(product.id, 1);
      const details = await Promise.all(result.substitutes.map((substitute) => fetchProduct(substitute.productId).catch(() => undefined)));
      const products = details.filter((candidate): candidate is Product => !!candidate);
      setState({ status: "ready", result, products: new Map(products.map((candidate) => [candidate.id, candidate])) });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : t("subs.loadFailed") });
    }
  }

  return (
    <>
      <button type="button" className="button-secondary button-small substitutes-open button-icon" onClick={() => void open()}>
        <ArrowLeftRight aria-hidden="true" size={15} />
        {t("subs.open")}
      </button>

      <dialog
        ref={dialogRef}
        className="substitutes-dialog"
        aria-labelledby={`substitutes-${product.id}`}
        onClick={(event) => {
          // A click on the backdrop closes the dialog.
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id={`substitutes-${product.id}`}>{t("subs.title", { name })}</h2>
            <p className="section-muted">{t("subs.intro")}</p>
          </div>
          <button type="button" className="dialog-close" aria-label={t("common.close")} onClick={() => dialogRef.current?.close()}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        {state.status === "loading" && <p className="section-muted dialog-body">{t("subs.loading")}</p>}
        {state.status === "error" && <p className="agent-error">{state.message}</p>}
        {state.status === "ready" && (
          <div className="dialog-body">
            <div className="compare-grid">
              <article className="compare-card compare-original">
                <p className="compare-tag">
                  <Ban aria-hidden="true" size={14} /> {t("subs.requested")}
                </p>
                <h3>{name}</h3>
                <p className="approval-supplier">{product.supplier}</p>
                <p className="compare-price">{formatEuroCents(product.pricePerPackageEurCents)}</p>
                <p className="compare-unmet">{state.result.requested.unmet.map(serverPhrase).join("; ") || t("subs.available")}</p>
                <dl className="compare-facts">
                  <div>
                    <dt>{t("product.package")}</dt>
                    <dd>{formatQuantity(product.packageSize.amount, product.packageSize.unit)}</dd>
                  </div>
                  <div>
                    <dt>{t("product.delivery")}</dt>
                    <dd>{formatDeliveryDate(product.deliveryDate)}</dd>
                  </div>
                </dl>
              </article>

              {state.result.substitutes.map((substitute) => {
                const details = rates.get(substitute.productId);
                return (
                  <article key={substitute.productId} className={`compare-card substitute-${substitute.tier}`}>
                    <p className="compare-tag">
                      <span className="tier-badge">{t(`tier.${substitute.tier}`)}</span>
                      <span className="substitute-match">{t("subs.score", { score: substitute.scores.combined })}</span>
                    </p>
                    <h3>{productName(substitute.productId, substitute.productName)}</h3>
                    <p className="approval-supplier">{substitute.supplier}</p>
                    <p className="compare-price">{formatEuroCents(substitute.costEurCents)}</p>
                    <p className="substitute-tradeoff">{substitute.tradeOff}</p>
                    <dl className="compare-facts">
                      <div>
                        <dt>{t("subs.order")}</dt>
                        <dd>
                          {formatPackages(substitute.packages)} ({formatQuantity(substitute.quantity.amount, substitute.quantity.unit)})
                        </dd>
                      </div>
                      <div>
                        <dt>{t("product.delivery")}</dt>
                        <dd>{formatDeliveryDate(substitute.deliveryDate)}</dd>
                      </div>
                    </dl>
                    {details?.deliveryReliability !== undefined && (
                      <p className="section-muted">{t("subs.reliability", { rate: formatPercent(details.deliveryReliability) })}</p>
                    )}
                    <ScoreBreakdown substitute={substitute} />
                  </article>
                );
              })}
            </div>

            {state.result.substitutes.length === 0 && (
              <p className="dash-empty">{state.result.nextStep ?? t("subs.none")}</p>
            )}

            {state.result.excluded.length > 0 && (
              <details className="substitutes-excluded">
                <summary>{t("subs.excluded", { count: state.result.excluded.length })}</summary>
                <ul>
                  {state.result.excluded.map((item) => (
                    <li key={item.productId}>
                      <strong>{item.supplier}</strong> {productName(item.productId, rates.get(item.productId)?.name ?? item.productId)}: {item.reasons.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

type Ranked = SubstitutesResult["substitutes"][number];

const PARTS: { key: "similarity" | "price" | "preference" | "availability"; label: MessageKey; weight: number }[] = [
  { key: "similarity", label: "subs.similarity", weight: 30 },
  { key: "price", label: "subs.price", weight: 25 },
  { key: "preference", label: "subs.preference", weight: 20 },
  { key: "availability", label: "subs.availability", weight: 25 },
];

/** The server's ranking in four weighted parts, so a buyer sees why best beats better. */
function ScoreBreakdown({ substitute }: { substitute: Ranked }) {
  const { t } = useI18n();
  const notes: Record<(typeof PARTS)[number]["key"], string> = {
    similarity: substitute.matchNotes.join(", ") || t("subs.sameCategory"),
    ...substitute.scoreNotes,
  };
  return (
    <ul className="score-breakdown" aria-label={t("subs.scoreAria", { score: substitute.scores.combined })}>
      {PARTS.map((part) => (
        <li key={part.key} title={notes[part.key]}>
          <span className="score-label">
            {t(part.label)} <span className="score-weight">{part.weight}%</span>
          </span>
          <span className="score-bar" aria-hidden="true">
            <span style={{ width: `${substitute.scores[part.key]}%` }} />
          </span>
          <span className="score-value">{substitute.scores[part.key]}</span>
          <span className="score-note">{notes[part.key]}</span>
        </li>
      ))}
    </ul>
  );
}
