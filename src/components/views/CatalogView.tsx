import { useId, useMemo, useState } from 'react';
import PageHero from '../ui/PageHero.tsx';
import { Checkbox, Select, TextInput } from '../ui/Field.tsx';
import { ToggleChip } from '../ui/Chip.tsx';
import { EmptyState } from '../ui/Card.tsx';
import Button from '../ui/Button.tsx';
import ProductCard from '../catalog/ProductCard.tsx';
import { CATALOG_SIZE, WHOLESALER_NAME, allergens, labels, products } from '../../data/mock.ts';
import {
  EMPTY_FILTERS,
  RANK_OPTIONS,
  apiPath,
  filterProducts,
  toggle,
  type CatalogFilters,
  type RankBy,
} from '../../lib/catalog.ts';
import '../../styles/catalog.css';

export default function CatalogView() {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const dateId = useId();

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b)),
    [],
  );
  const results = useMemo(() => filterProducts(products, filters), [filters]);

  const update = (patch: Partial<CatalogFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <>
      <PageHero
        title="Catalog"
        lead="The same search and ranking the agents use, with labels, origin, allergens, nutrition, and delivery reliability."
      />

      <div className="container page-body catalog">
        <div className="catalog__head">
          <h2 className="section-title">{WHOLESALER_NAME}'s catalog</h2>
          <p className="catalog__count" aria-live="polite">
            {results.length} {results.length === 1 ? 'product' : 'products'}
          </p>
        </div>
        <p className="section-intro">
          {CATALOG_SIZE} products. The search runs over {WHOLESALER_NAME}'s product data, and the best matches get live
          price and availability from its APIs.
        </p>

        <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
          <div className="filters__row">
            <TextInput
              className="filters__search"
              label="Search products"
              hideLabel
              type="search"
              placeholder="Search in English or Finnish, for example lactose-free milk"
              value={filters.query}
              onChange={(event) => update({ query: event.target.value })}
            />
            <Select
              className="filters__category"
              label="Category"
              hideLabel
              value={filters.category}
              onChange={(event) => update({ category: event.target.value })}
              options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
            />
            <Select
              className="filters__rank"
              label="Rank by"
              inline
              value={filters.rank}
              onChange={(event) => update({ rank: event.target.value as RankBy })}
              options={RANK_OPTIONS}
            />
            <div className="field filters__date">
              <label htmlFor={dateId} className="field__label filters__date-label">
                Delivery by
              </label>
              <input
                id={dateId}
                className="input"
                type="date"
                min="2026-11-16"
                value={filters.deliveryBy}
                onChange={(event) => update({ deliveryBy: event.target.value })}
              />
            </div>
            <Checkbox
              className="filters__deliverable"
              label="Deliverable only"
              checked={filters.deliverableOnly}
              onChange={(event) => update({ deliverableOnly: event.target.checked })}
            />
          </div>

          <fieldset className="filters__chips">
            <legend className="filters__legend">Labels</legend>
            <div className="filters__chip-list">
              {labels.map((label) => (
                <ToggleChip
                  key={label.id}
                  pressed={filters.labels.includes(label.id)}
                  onToggle={() => update({ labels: toggle(filters.labels, label.id) })}
                >
                  {label.name}
                </ToggleChip>
              ))}
            </div>
          </fieldset>

          <fieldset className="filters__chips">
            <legend className="filters__legend">Free from</legend>
            <div className="filters__chip-list">
              {allergens.map((allergen) => (
                <ToggleChip
                  key={allergen.id}
                  pressed={filters.freeFrom.includes(allergen.id)}
                  onToggle={() => update({ freeFrom: toggle(filters.freeFrom, allergen.id) })}
                >
                  {allergen.name}
                </ToggleChip>
              ))}
            </div>
          </fieldset>

          <div className="filters__api">
            <code className="api-chip" aria-label="Request sent to the wholesaler's API">
              GET {apiPath(filters)}
            </code>
          </div>
        </form>

        {results.length === 0 ? (
          <div className="catalog__empty">
            <EmptyState title="No products match">
              Try fewer labels or allergens, or a later delivery date.
            </EmptyState>
            <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear the filters
            </Button>
          </div>
        ) : (
          <ul className="product-grid" role="list">
            {results.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
