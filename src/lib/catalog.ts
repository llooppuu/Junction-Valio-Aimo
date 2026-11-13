import type { AllergenId, LabelId, Product } from './types.ts';

export type RankBy = 'catalog' | 'price' | 'reliability' | 'carbon';

export const RANK_OPTIONS: { value: RankBy; label: string }[] = [
  { value: 'catalog', label: 'Catalog order' },
  { value: 'price', label: 'Lowest unit price' },
  { value: 'reliability', label: 'Delivery reliability' },
  { value: 'carbon', label: 'Lowest carbon footprint' },
];

export interface CatalogFilters {
  query: string;
  category: string;
  rank: RankBy;
  /** ISO date (yyyy-mm-dd) or empty. */
  deliveryBy: string;
  deliverableOnly: boolean;
  labels: LabelId[];
  freeFrom: AllergenId[];
}

export const EMPTY_FILTERS: CatalogFilters = {
  query: '',
  category: '',
  rank: 'catalog',
  deliveryBy: '',
  deliverableOnly: false,
  labels: [],
  freeFrom: [],
};

export function isDeliverable(product: Product): boolean {
  return (
    product.delivery !== undefined && (product.stock.status === 'plenty' || product.stock.status === 'packages')
  );
}

export function isUnavailable(product: Product): boolean {
  return product.stock.status === 'none' || product.stock.status === 'undeliverable';
}

export function stockLabel(product: Product): string {
  const { stock } = product;
  switch (stock.status) {
    case 'plenty':
      return 'Plenty in stock';
    case 'packages':
      return `${stock.count.toLocaleString('en-GB')} packages (${stock.amount})`;
    case 'none':
      return 'none available';
    case 'undeliverable':
      return 'Valio Aimo cannot deliver it on any date';
    case 'cutoff':
      return stock.message;
  }
}

function matchesQuery(product: Product, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    product.name,
    product.nameFi,
    product.brand ?? '',
    product.supplier,
    product.category,
    product.origin,
    ...product.tags,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterProducts(products: Product[], filters: CatalogFilters): Product[] {
  const result = products.filter((product) => {
    if (!matchesQuery(product, filters.query)) return false;
    if (filters.category && product.category !== filters.category) return false;
    if (filters.deliverableOnly && !isDeliverable(product)) return false;
    if (filters.deliveryBy && (!isDeliverable(product) || (product.delivery?.date ?? '') > filters.deliveryBy)) {
      return false;
    }
    if (!filters.labels.every((label) => product.labels.includes(label))) return false;
    if (filters.freeFrom.length > 0) {
      const declared = product.allergens;
      if (declared === null || declared === 'n/a') return false;
      if (!filters.freeFrom.every((id) => declared.freeFrom.includes(id))) return false;
    }
    return true;
  });

  switch (filters.rank) {
    case 'price':
      return [...result].sort((a, b) => a.comparePrice - b.comparePrice);
    case 'reliability':
      return [...result].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0));
    case 'carbon':
      return [...result].sort((a, b) => (a.carbon ?? Infinity) - (b.carbon ?? Infinity));
    default:
      return result;
  }
}

/** The request the catalog would send to the wholesaler's API for these filters. */
export function apiPath(filters: CatalogFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set('q', filters.query.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.rank !== 'catalog') params.set('rank', filters.rank);
  if (filters.deliveryBy) params.set('deliverable_by', filters.deliveryBy);
  if (filters.deliverableOnly) params.set('deliverable', 'true');
  if (filters.labels.length) params.set('labels', filters.labels.join(','));
  if (filters.freeFrom.length) params.set('free_from', filters.freeFrom.join(','));
  const query = params.toString().replace(/%2C/g, ',');
  return `/api/products${query ? `?${query}` : ''}`;
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
