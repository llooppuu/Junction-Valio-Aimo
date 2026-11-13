import { useEffect, useRef } from 'react';
import { Ban, X } from 'lucide-react';
import Badge from '../ui/Badge.tsx';
import Meter from '../ui/Meter.tsx';
import { formatEuro } from '../../lib/format.ts';
import type { Product, Substitute, SubstituteSet } from '../../lib/types.ts';
import '../../styles/substitutes.css';

const RANK_LABEL: Record<Substitute['rank'], string> = { best: 'Best', better: 'Better', good: 'Good' };

interface SubstitutesDialogProps {
  product: Product | null;
  set: SubstituteSet | undefined;
  onClose: () => void;
}

function packageWeight(product: Product): string {
  return product.packageSize.split('=')[1]?.trim() ?? product.packageSize;
}

function SubstituteCard({ substitute }: { substitute: Substitute }) {
  return (
    <article className={`sub-card sub-card--${substitute.rank}`} aria-label={`${RANK_LABEL[substitute.rank]}: ${substitute.name}`}>
      <div className="sub-card__top">
        <Badge tone={substitute.rank}>{RANK_LABEL[substitute.rank]}</Badge>
        <span className="sub-card__score">Score {substitute.score}</span>
      </div>
      <h3 className="sub-card__name">{substitute.name}</h3>
      <p className="sub-card__supplier">{substitute.supplier}</p>
      <p className="sub-card__price">{formatEuro(substitute.price)}</p>
      <p className="sub-card__note">{substitute.priceNote}</p>
      <dl className="sub-card__facts">
        <div>
          <dt>Order</dt>
          <dd>{substitute.order}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{substitute.delivery}</dd>
        </div>
      </dl>
      <p className="sub-card__delivered">{substitute.deliveredAsOrdered}</p>
      <ul className="sub-card__criteria" role="list">
        {substitute.criteria.map((criterion) => (
          <li key={criterion.name}>
            <div className="sub-card__criterion">
              <span>
                {criterion.name} <span className="sub-card__weight">{criterion.weight}%</span>
              </span>
              <Meter value={criterion.score / 100} label={`${criterion.name} score`} />
              <span className="sub-card__criterion-score">{criterion.score}</span>
            </div>
            <p className="sub-card__criterion-note">{criterion.note}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Ranked substitutes for a product that cannot be delivered, in a modal dialog. */
export default function SubstitutesDialog({ product, set, onClose }: SubstitutesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = product !== null && set !== undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="sub-dialog"
      aria-labelledby="sub-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {product && set && (
        <div className="sub-dialog__inner">
          <header className="sub-dialog__head">
            <div>
              <h2 id="sub-dialog-title" className="sub-dialog__title">
                Substitutes for {product.name}
              </h2>
              <p className="sub-dialog__intro">
                Ranked by the server for one package. Anything that breaks a rule is listed below with the reason, never
                offered.
              </p>
            </div>
            <button type="button" className="sub-dialog__close" onClick={onClose} aria-label="Close substitutes">
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="sub-dialog__body">
            <div className="sub-grid">
              <article className="sub-card sub-card--requested" aria-label={`Requested: ${product.name}`}>
                <p className="sub-card__requested">
                  <Ban size={14} aria-hidden="true" /> Requested
                </p>
                <h3 className="sub-card__name">{product.name}</h3>
                <p className="sub-card__supplier">{product.supplier}</p>
                <p className="sub-card__price">{formatEuro(product.price)}</p>
                <p className="sub-card__reason">{set.reason}</p>
                <dl className="sub-card__facts">
                  <div>
                    <dt>Package</dt>
                    <dd>{packageWeight(product)}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>–</dd>
                  </div>
                </dl>
              </article>
              {set.candidates.map((substitute) => (
                <SubstituteCard key={substitute.name} substitute={substitute} />
              ))}
            </div>

            <details className="sub-dialog__unsuitable">
              <summary>{set.unsuitable.length} not suitable, and why</summary>
              <ul className="sub-dialog__unsuitable-list">
                {set.unsuitable.map((item) => (
                  <li key={item.name}>
                    <span className="sub-dialog__unsuitable-name">{item.name}</span>
                    <span className="sub-dialog__unsuitable-reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}
    </dialog>
  );
}
