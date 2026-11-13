import { useState } from 'react';
import { ArrowLeftRight, FileSignature } from 'lucide-react';
import Meter from '../ui/Meter.tsx';
import Button from '../ui/Button.tsx';
import { AllergenTag, Tag } from '../ui/Chip.tsx';
import { allergens as allAllergens } from '../../data/mock.ts';
import { formatEuro, formatPercent } from '../../lib/format.ts';
import { isUnavailable, stockLabel } from '../../lib/catalog.ts';
import type { Product } from '../../lib/types.ts';

type SignatureState = 'unchecked' | 'valid' | 'tampered' | 'invalid';

interface ProductCardProps {
  product: Product;
  /** Opens the ranked substitutes; only given when the product has some. */
  onShowSubstitutes?: (product: Product) => void;
}

function allergenName(id: string): { name: string; code: string } {
  const allergen = allAllergens.find((item) => item.id === id);
  return { name: allergen?.name ?? id, code: allergen?.code ?? '' };
}

export default function ProductCard({ product, onShowSubstitutes }: ProductCardProps) {
  const [signature, setSignature] = useState<SignatureState>('unchecked');
  const unavailable = product.stock.status !== 'plenty' && product.stock.status !== 'packages';
  const shownPrice = signature === 'tampered' || signature === 'invalid' ? product.price * 0.5 : product.price;

  const verify = () => setSignature((state) => (state === 'tampered' || state === 'invalid' ? 'invalid' : 'valid'));
  const tamper = () => setSignature('tampered');

  return (
    <article className="product" aria-labelledby={`${product.id}-name`}>
      <p className="product__category">{product.category}</p>
      <h3 id={`${product.id}-name`} className="product__name">
        {product.name}
      </h3>
      <p className="product__source">
        {product.brand && <span className="product__supplier">{product.brand} · </span>}
        <span className="product__supplier">{product.supplier}</span>
        <span className="product__origin"> · {product.origin}</span>
      </p>

      <div className="product__price-row">
        <p className={`product__price${signature === 'tampered' || signature === 'invalid' ? ' is-tampered' : ''}`}>
          {formatEuro(shownPrice)} <span className="product__unit">/ {product.unit}</span>
        </p>
        <p className="product__compare">
          {formatEuro(product.comparePrice)} / {product.compareUnit}
        </p>
      </div>
      <p className="product__vat">Without VAT ({product.vat} %)</p>

      <dl className="product__facts">
        <div>
          <dt>Package</dt>
          <dd>{product.packageSize}</dd>
        </div>
        <div>
          <dt>Stock</dt>
          <dd className={unavailable ? 'is-bad' : undefined}>{stockLabel(product)}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>
            {product.delivery && !unavailable ? (
              <>
                {product.delivery.label}
                {product.delivery.orderBy && (
                  <span className="product__order-by">Order by {product.delivery.orderBy}</span>
                )}
              </>
            ) : (
              '–'
            )}
          </dd>
        </div>
        {product.reliability !== undefined && (
          <div>
            <dt>Reliability</dt>
            <dd className="product__reliability">
              <Meter value={product.reliability} label={`${product.name} delivery reliability`} />
              {formatPercent(product.reliability)}
            </dd>
          </div>
        )}
        {product.carbon !== undefined && (
          <div>
            <dt>Carbon footprint</dt>
            <dd>
              ≈ {product.carbon.toFixed(2)} kg CO<sub>2</sub>e/kg
            </dd>
          </div>
        )}
      </dl>

      {product.allergens === null && <p className="product__undeclared">The manufacturer has not declared allergens</p>}
      {product.allergens !== null && product.allergens !== 'n/a' && (
        <dl className="product__allergens">
          {product.allergens.contains.length > 0 && (
            <div>
              <dt>Contains</dt>
              <dd>
                {product.allergens.contains.map((id) => (
                  <AllergenTag key={id} {...allergenName(id)} contains />
                ))}
              </dd>
            </div>
          )}
          {product.allergens.freeFrom.length > 0 && (
            <div>
              <dt>Free from</dt>
              <dd>
                {product.allergens.freeFrom.map((id) => (
                  <AllergenTag key={id} {...allergenName(id)} contains={false} />
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="product__signature">
        <FileSignature size={15} aria-hidden="true" />
        <span>Signed until {product.signedUntil}</span>
        <button type="button" className="product__sig-action" onClick={verify}>
          Verify
        </button>
        <button type="button" className="product__sig-action" onClick={tamper} disabled={signature === 'tampered'}>
          Tamper
        </button>
      </div>
      {signature !== 'unchecked' && (
        <p className={`product__sig-result is-${signature}`} role="status">
          {signature === 'valid' && 'Signature valid: price and stock are exactly what Valio Aimo signed.'}
          {signature === 'tampered' && 'The price was changed in the browser. Verify to see the check fail.'}
          {signature === 'invalid' && 'Signature check failed: the data was changed after Valio Aimo signed it.'}
        </p>
      )}

      {onShowSubstitutes && isUnavailable(product) && (
        <Button
          variant="outline"
          size="sm"
          className="product__substitutes"
          icon={<ArrowLeftRight size={16} aria-hidden="true" />}
          onClick={() => onShowSubstitutes(product)}
        >
          See substitutes
        </Button>
      )}

      <details className="product__details">
        <summary>Nutrition and product details</summary>
        <div className="product__details-body">
          <p>
            Valio Aimo code <code>{product.code}</code> · GTIN <code>{product.gtin}</code>
          </p>
          {product.nutrition && (
            <table className="nutrition">
              <caption>Nutrition per 100 g</caption>
              <tbody>
                <tr>
                  <th scope="row">Energy</th>
                  <td>
                    {product.nutrition.energyKj} kJ / {product.nutrition.energyKcal} kcal
                  </td>
                </tr>
                <tr>
                  <th scope="row">Fat</th>
                  <td>{product.nutrition.fat} g</td>
                </tr>
                <tr>
                  <th scope="row">Carbohydrate</th>
                  <td>{product.nutrition.carbohydrate} g</td>
                </tr>
                <tr>
                  <th scope="row">of which sugars</th>
                  <td>{product.nutrition.sugars} g</td>
                </tr>
                <tr>
                  <th scope="row">Protein</th>
                  <td>{product.nutrition.protein} g</td>
                </tr>
                <tr>
                  <th scope="row">Salt</th>
                  <td>{product.nutrition.salt} g</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="product__answered">Price and availability from Valio Aimo, answered at {product.answeredAt}</p>
        </div>
      </details>

      {product.tags.length > 0 && (
        <div className="product__tags">
          {product.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      )}
    </article>
  );
}
